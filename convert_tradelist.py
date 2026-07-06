#!/usr/bin/env python3
"""
Convert Sierra Chart TradeList export to sample_trade_logs.txt format

This script reads a TradeList file exported from Sierra Chart and converts it
to the trade_logs.txt format used by the Trading Dashboard.

Usage:
    python convert_tradelist.py <input_file> [output_file]
    
Example:
    python convert_tradelist.py TradeList.csv sample_trade_logs.txt
"""

import csv
import sys
import os
from datetime import datetime
from typing import List, Dict, Optional
from pathlib import Path


# Configuration: Risk calculation and assumptions
TICK_VALUE = 0.50  # MNQ: $0.50 per point per contract
DEFAULT_RISK_AMOUNT = 250.0  # Default risk if not specified


class TradeListConverter:
    """Converts Sierra Chart TradeList to trade_logs.txt format"""
    
    def __init__(self):
        self.trades = []
    
    def detect_delimiter(self, filepath: str) -> str:
        """Detect CSV delimiter (comma, tab, or semicolon)"""
        with open(filepath, 'r', encoding='utf-8') as f:
            first_line = f.readline()
            if '\t' in first_line:
                return '\t'
            elif ';' in first_line:
                return ';'
            else:
                return ','
    
    def normalize_column_name(self, name: str) -> str:
        """Normalize column names to handle variations"""
        name = name.strip().lower()
        # Common variations
        mappings = {
            'date': 'date',
            'time': 'time',
            'datetime': 'datetime',
            'entry datetime': 'entry_datetime',
            'entry date': 'date',
            'entry time': 'time',
            'exit datetime': 'exit_datetime',
            'exit date': 'exit_date',
            'exit time': 'exit_time',
            'entry price': 'entry_price',
            'exit price': 'exit_price',
            'entryprice': 'entry_price',
            'exitprice': 'exit_price',
            'quantity': 'quantity',
            'trade quantity': 'quantity',
            'qty': 'quantity',
            'contracts': 'quantity',
            'direction': 'direction',
            'trade type': 'direction',
            'side': 'direction',
            'buy/sell': 'direction',
            'pnl': 'pnl',
            'profit': 'pnl',
            'profit/loss': 'pnl',
            'profit/loss (c)': 'pnl',
            'p&l': 'pnl',
            'sl': 'sl_points',
            'stop loss': 'sl_points',
            'stop': 'sl_points',
            'tp': 'tp_points',
            'take profit': 'tp_points',
            'target': 'tp_points',
            'risk': 'risk_amount',
            'risk amount': 'risk_amount',
        }
        return mappings.get(name, name)
    
    def parse_tradelist(self, filepath: str) -> List[Dict]:
        """Parse TradeList file and extract trade data"""
        trades = []
        delimiter = self.detect_delimiter(filepath)
        
        with open(filepath, 'r', encoding='utf-8') as f:
            # Try to read as CSV/TSV
            try:
                reader = csv.DictReader(f, delimiter=delimiter)
                fieldnames = [self.normalize_column_name(fn) for fn in reader.fieldnames or []]
                
                for row in reader:
                    trade = {}
                    for orig_field, value in row.items():
                        norm_field = self.normalize_column_name(orig_field)
                        trade[norm_field] = value.strip() if value else None
                    
                    # Only process rows that look like trades
                    if trade.get('entry_price') or trade.get('pnl') or trade.get('quantity'):
                        trades.append(trade)
            
            except Exception as e:
                print(f"Error parsing file: {e}")
                print("Trying alternative parsing methods...")
                # Could add fallback parsing here
        
        return trades
    
    def parse_datetime(self, date_str: Optional[str], time_str: Optional[str] = None) -> Optional[datetime]:
        """Parse date/time strings into datetime object"""
        if not date_str:
            return None
        
        # Remove BP/EP suffixes and extra spaces (Sierra Chart format)
        datetime_str = date_str.replace(' BP', '').replace(' EP', '').strip()
        # Handle double spaces
        datetime_str = ' '.join(datetime_str.split())
        
        # Combine date and time if separate
        if time_str and datetime_str and ' ' not in datetime_str:
            datetime_str = f"{datetime_str} {time_str}"
        
        # Try common formats
        formats = [
            '%Y-%m-%d  %H:%M:%S.%f',  # Sierra Chart format with double space
            '%Y-%m-%d %H:%M:%S.%f',
            '%Y-%m-%d %H:%M:%S',
            '%m/%d/%Y %H:%M:%S.%f',
            '%m/%d/%Y %H:%M:%S',
            '%Y-%m-%d',
            '%m/%d/%Y',
        ]
        
        for fmt in formats:
            try:
                return datetime.strptime(datetime_str, fmt)
            except ValueError:
                continue
        
        return None
    
    def determine_direction(self, trade: Dict) -> str:
        """Determine trade direction from available data"""
        direction = trade.get('direction', '') or ''
        direction = direction.lower() if direction else ''
        
        if 'long' in direction or 'buy' in direction or direction == 'b':
            return 'long'
        elif 'short' in direction or 'sell' in direction or direction == 's':
            return 'short'
        
        # Try to infer from entry/exit prices
        entry_price = self.parse_float(trade.get('entry_price'))
        exit_price = self.parse_float(trade.get('exit_price'))
        pnl = self.parse_float(trade.get('pnl'))
        
        if entry_price and exit_price:
            if exit_price > entry_price and pnl and pnl > 0:
                return 'long'
            elif exit_price < entry_price and pnl and pnl > 0:
                return 'short'
            elif exit_price > entry_price:
                return 'short'  # Loss on long
            else:
                return 'long'  # Loss on short
        
        return 'long'  # Default
    
    def parse_float(self, value: Optional[str]) -> Optional[float]:
        """Parse float value, handling currency symbols and formatting"""
        if not value:
            return None
        try:
            # Remove currency symbols, commas, spaces
            cleaned = value.replace('$', '').replace(',', '').replace(' ', '')
            return float(cleaned)
        except (ValueError, AttributeError):
            return None
    
    def parse_int(self, value: Optional[str]) -> Optional[int]:
        """Parse integer value"""
        if not value:
            return None
        try:
            return int(float(value))
        except (ValueError, AttributeError):
            return None
    
    def calculate_metrics(self, trade: Dict) -> Dict:
        """Calculate trade metrics (risk, reward, R:R, etc.)"""
        entry_price = self.parse_float(trade.get('entry_price'))
        exit_price = self.parse_float(trade.get('exit_price'))
        quantity = self.parse_int(trade.get('quantity')) or 1
        pnl = self.parse_float(trade.get('pnl'))
        direction = self.determine_direction(trade)
        
        # Calculate P&L if not provided
        if pnl is None and entry_price and exit_price:
            if direction == 'long':
                points_diff = exit_price - entry_price
            else:
                points_diff = entry_price - exit_price
            pnl = points_diff * quantity * TICK_VALUE
        
        # Get risk amount
        risk_amount = self.parse_float(trade.get('risk_amount')) or DEFAULT_RISK_AMOUNT
        
        # Get SL/TP points
        sl_points = self.parse_float(trade.get('sl_points'))
        tp_points = self.parse_float(trade.get('tp_points'))
        
        # Calculate SL points if not provided
        if sl_points is None and risk_amount and quantity:
            # SL points = risk_amount / (quantity * tick_value)
            sl_points = risk_amount / (quantity * TICK_VALUE)
        
        # Calculate TP points if not provided
        if tp_points is None and sl_points:
            tp_points = sl_points * 2  # Assume 1:2 R:R
        
        # Calculate reward points
        if entry_price and exit_price:
            if direction == 'long':
                reward_points = exit_price - entry_price
            else:
                reward_points = entry_price - exit_price
        else:
            reward_points = 0
        
        # Calculate R:R ratio
        if sl_points and sl_points > 0:
            rr_ratio = reward_points / sl_points
        else:
            rr_ratio = 0
        
        # Calculate estimated dollar risked
        est_dollar_risked = sl_points * quantity * TICK_VALUE if sl_points else risk_amount
        
        return {
            'entry_price': entry_price,
            'exit_price': exit_price,
            'quantity': quantity,
            'direction': direction,
            'pnl': pnl or 0,
            'risk_amount': risk_amount,
            'sl_points': sl_points or 0,
            'tp_points': tp_points or 0,
            'reward_points': reward_points,
            'rr_ratio': rr_ratio,
            'est_dollar_risked': est_dollar_risked,
        }
    
    def convert_to_trade_log(self, trade: Dict) -> str:
        """Convert a trade dictionary to trade_logs.txt format"""
        # Parse datetime - try entry_datetime first (Sierra Chart format)
        entry_dt = self.parse_datetime(
            trade.get('entry_datetime') or trade.get('datetime') or trade.get('date'),
            trade.get('time')
        )
        
        if not entry_dt:
            # Try exit date/time as fallback
            entry_dt = self.parse_datetime(
                trade.get('exit_datetime') or trade.get('exit_date'),
                trade.get('exit_time')
            )
        
        if not entry_dt:
            # Use current time as last resort
            entry_dt = datetime.now()
        
        # Calculate metrics
        metrics = self.calculate_metrics(trade)
        
        # Format timestamps
        entry_formatted = entry_dt.strftime('%Y-%m-%d %H:%M:%S,%f')[:-3]  # milliseconds
        entry_timestamp_display = entry_dt.strftime('%Y-%m-%d  %H:%M:%S.%f')
        
        # Build trade log lines
        lines = [
            f"{entry_formatted} - === NEW TRADE ===",
            f"{entry_formatted} - Trade timestamp: {entry_timestamp_display}",
            f"{entry_formatted} - Direction: {metrics['direction']}",
        ]
        
        if metrics['risk_amount']:
            lines.append(f"{entry_formatted} - Risk amount: ${metrics['risk_amount']:.2f}")
        
        if metrics['sl_points']:
            lines.append(f"{entry_formatted} - SL points: {metrics['sl_points']:.1f}")
        
        if metrics['tp_points']:
            lines.append(f"{entry_formatted} - TP points: {metrics['tp_points']:.1f}")
        
        lines.append(f"{entry_formatted} - Order quantity: {metrics['quantity']}")
        
        if metrics['est_dollar_risked']:
            lines.append(f"{entry_formatted} - Est dollar risked: ${metrics['est_dollar_risked']:.2f}")
        
        # Add exit information if available
        exit_dt = self.parse_datetime(
            trade.get('exit_datetime') or trade.get('exit_date'),
            trade.get('exit_time')
        )
        
        if exit_dt and metrics['exit_price']:
            exit_formatted = exit_dt.strftime('%Y-%m-%d %H:%M:%S,%f')[:-3]
            
            lines.append(f"{exit_formatted} - === TRADE CLOSED ===")
            lines.append(f"{exit_formatted} - Entry: {metrics['entry_price']:.2f} | Exit: {metrics['exit_price']:.2f}")
            lines.append(f"{exit_formatted} - Risk: {metrics['sl_points']:.1f} pts | Reward: {metrics['reward_points']:.1f} pts")
            lines.append(f"{exit_formatted} - R:R Ratio: {metrics['rr_ratio']:.2f}R")
            lines.append(f"{exit_formatted} - P&L: ${metrics['pnl']:.2f}")
        
        return '\n'.join(lines)
    
    def convert_file(self, input_file: str, output_file: str):
        """Convert TradeList file to trade_logs.txt format"""
        print(f"Reading TradeList file: {input_file}")
        
        trades = self.parse_tradelist(input_file)
        print(f"Found {len(trades)} trades")
        
        if not trades:
            print("No trades found in file. Please check the file format.")
            return
        
        # Convert each trade
        log_lines = []
        for i, trade in enumerate(trades, 1):
            try:
                trade_log = self.convert_to_trade_log(trade)
                if trade_log:
                    log_lines.append(trade_log)
                    log_lines.append('')  # Empty line between trades
            except Exception as e:
                print(f"Warning: Error converting trade {i}: {e}")
                continue
        
        # Write output file
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write('\n'.join(log_lines))
            if log_lines and log_lines[-1] != '':
                f.write('\n')
        
        print(f"\nConversion complete!")
        print(f"Output written to: {output_file}")
        print(f"Total trades converted: {len(log_lines) // 2}")


def main():
    """Main entry point"""
    if len(sys.argv) < 2:
        print(__doc__)
        print("\nUsage: python convert_tradelist.py <input_file> [output_file]")
        print("\nExample:")
        print("  python convert_tradelist.py TradeList.csv")
        print("  python convert_tradelist.py TradeList.csv sample_trade_logs.txt")
        sys.exit(1)
    
    input_file = sys.argv[1]
    
    if not os.path.exists(input_file):
        print(f"Error: Input file not found: {input_file}")
        sys.exit(1)
    
    # Determine output file
    if len(sys.argv) >= 3:
        output_file = sys.argv[2]
    else:
        # Default: sample_trade_logs.txt in same directory
        input_path = Path(input_file)
        output_file = str(input_path.parent / 'sample_trade_logs.txt')
    
    # Convert
    converter = TradeListConverter()
    converter.convert_file(input_file, output_file)


if __name__ == '__main__':
    main()
