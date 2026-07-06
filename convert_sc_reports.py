#!/usr/bin/env python3
"""
Convert Sierra Chart trade reports to NQ_Trade_System trade_logs.txt format
Merges SC-Trade-Report-1 and SC-Trade-Report-2 into a single trade_logs.txt file
"""

import csv
from datetime import datetime, timedelta
from typing import List, Dict, Optional
from pathlib import Path
import os

# Configuration: Risk calculation method
# For winners and losers, cap at typical R:R multiples
MAX_RR_FOR_WINNERS = 3.0  # Cap winners at 3R
MAX_RR_FOR_LOSERS = 1.0   # Cap losers at 1R

# Date-based risk amounts
RISK_BEFORE_NOV_13 = 60.0   # August - Nov 12: $60 risk
RISK_AFTER_NOV_12 = 250.0   # Nov 13+: $250 risk
CUTOFF_DATE = datetime(2025, 11, 13)  # November 13, 2025


class Trade:
    """Represents a complete trade with entry and exit"""
    def __init__(self):
        self.entry_time: Optional[str] = None
        self.exit_time: Optional[str] = None
        self.direction: Optional[str] = None  # 'long' or 'short'
        self.quantity: Optional[int] = None
        self.entry_price: Optional[float] = None
        self.exit_price: Optional[float] = None
        self.internal_order_id: Optional[str] = None
    
    @staticmethod
    def convert_et_to_pt(et_timestamp: str) -> datetime:
        """Convert UTC timestamp to Eastern Time (NYC time)"""
        dt = datetime.strptime(et_timestamp, '%Y-%m-%d  %H:%M:%S.%f')
        # Sierra Chart logs in UTC, convert to Eastern Time
        # EDT (summer): UTC-4, EST (winter): UTC-5
        # Using EDT offset for Aug-early Nov, EST after Nov 3
        if dt.month >= 3 and dt.month < 11:
            # Daylight Saving Time (EDT): UTC-4
            et_dt = dt - timedelta(hours=4)
        elif dt.month == 11 and dt.day < 3:
            # Early November, still EDT
            et_dt = dt - timedelta(hours=4)
        else:
            # Standard Time (EST): UTC-5
            et_dt = dt - timedelta(hours=5)
        return et_dt
        
    def calculate_metrics(self) -> Dict:
        """Calculate risk, reward, R:R ratio, and P&L"""
        if not all([self.entry_price, self.exit_price, self.quantity]):
            return {
                'sl_points': None,
                'tp_points': None,
                'risk_points': None,
                'reward_points': None,
                'rr_ratio': None,
                'pnl': None,
                'risk_amount': None
            }
        
        # Calculate points difference (in ticks)
        if self.direction == 'long':
            points_diff = self.exit_price - self.entry_price
        else:  # short
            points_diff = self.entry_price - self.exit_price
        
        # MNQ: Each tick is $0.50 per contract
        tick_value = 0.50
        pnl = points_diff * self.quantity * tick_value
        
        # Determine base risk amount based on trade date
        # Nov 12 and before: $60, Nov 13+: $250
        if self.entry_time:
            trade_date = datetime.strptime(self.entry_time, '%Y-%m-%d  %H:%M:%S.%f')
            # Compare date only (ignore time)
            trade_date_only = trade_date.date()
            cutoff_date_only = CUTOFF_DATE.date()
            if trade_date_only < cutoff_date_only:
                base_risk = RISK_BEFORE_NOV_13  # $60 (Nov 12 and before)
            else:
                base_risk = RISK_AFTER_NOV_12   # $250 (Nov 13+)
        else:
            base_risk = RISK_BEFORE_NOV_13  # Default
        
        # Calculate risk and R:R based on outcome
        risk_amount = base_risk
        
        if pnl > 0:
            # Winner: cap at 3R
            max_win = base_risk * MAX_RR_FOR_WINNERS
            actual_pnl = min(pnl, max_win)  # Cap profit at 3R
            rr_ratio = actual_pnl / risk_amount
        elif pnl < 0:
            # Loser: cap at 1R (the risk amount)
            actual_pnl = -base_risk  # Cap loss at risk amount
            rr_ratio = -MAX_RR_FOR_LOSERS  # Always -1R for losers
        else:
            # Breakeven
            actual_pnl = 0
            rr_ratio = 0
        
        # Calculate risk/reward in ticks
        risk_ticks_total = risk_amount / tick_value
        reward_ticks_total = actual_pnl / tick_value
        
        # For display: show per-contract values
        risk_ticks_per_contract = risk_ticks_total / self.quantity if self.quantity > 0 else 0
        reward_ticks_per_contract = actual_pnl / tick_value / self.quantity if self.quantity > 0 else 0
        
        # TP would be based on typical target (assume 2R for winners, actual for losers)
        if actual_pnl > 0:
            tp_ticks = abs(reward_ticks_per_contract)
        else:
            tp_ticks = risk_ticks_per_contract * 2  # Assumed target
        
        return {
            'sl_points': risk_ticks_per_contract,
            'tp_points': tp_ticks,
            'risk_points': risk_ticks_per_contract,
            'reward_points': reward_ticks_per_contract,
            'rr_ratio': rr_ratio,
            'pnl': actual_pnl,
            'risk_amount': risk_amount
        }
    
    def to_trade_log_format(self) -> str:
        """Convert to NQ_Trade_System trade_logs.txt format"""
        if not all([self.entry_time, self.direction, self.quantity]):
            return ""
        
        metrics = self.calculate_metrics()
        
        # Convert ET to PT and format timestamps
        entry_dt_pt = self.convert_et_to_pt(self.entry_time)
        entry_formatted = entry_dt_pt.strftime('%Y-%m-%d %H:%M:%S,%f')[:-3]  # milliseconds
        entry_timestamp_display = entry_dt_pt.strftime('%Y-%m-%d  %H:%M:%S.%f')
        
        lines = [
            f"{entry_formatted} - === NEW TRADE ===",
            f"{entry_formatted} - Trade timestamp: {entry_timestamp_display}",
            f"{entry_formatted} - Direction: {self.direction}",
        ]
        
        if metrics['risk_amount']:
            lines.append(f"{entry_formatted} - Risk amount: ${metrics['risk_amount']:.2f}")
        if metrics['sl_points']:
            lines.append(f"{entry_formatted} - SL points: {metrics['sl_points']:.1f}")
        if metrics['tp_points']:
            lines.append(f"{entry_formatted} - TP points: {metrics['tp_points']:.1f}")
        
        lines.append(f"{entry_formatted} - Order quantity: {self.quantity}")
        
        # Add exit information if trade is closed
        if self.exit_time and self.exit_price:
            exit_dt_pt = self.convert_et_to_pt(self.exit_time)
            exit_formatted = exit_dt_pt.strftime('%Y-%m-%d %H:%M:%S,%f')[:-3]
            
            lines.append(f"{exit_formatted} - === TRADE CLOSED ===")
            
            # Convert prices to points format (divide by 100 for display)
            entry_display = self.entry_price / 100.0
            exit_display = self.exit_price / 100.0
            
            lines.append(f"{exit_formatted} - Entry: {entry_display:.2f} | Exit: {exit_display:.2f}")
            lines.append(f"{exit_formatted} - Risk: -{metrics['risk_points']:.1f} pts | Reward: {metrics['reward_points']:.1f} pts")
            lines.append(f"{exit_formatted} - R:R Ratio: {metrics['rr_ratio']:.1f}R")
            lines.append(f"{exit_formatted} - P&L: ${metrics['pnl']:.2f}")
        
        return '\n'.join(lines)


def parse_sc_report(filepath: str) -> List[Dict]:
    """Parse a Sierra Chart trade report TSV file"""
    trades = []
    
    with open(filepath, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f, delimiter='\t')
        
        for row in reader:
            if row['ActivityType'] == 'Fills':
                trades.append({
                    'datetime': row['DateTime'],
                    'trans_datetime': row['TransDateTime'],
                    'buy_sell': row['BuySell'],
                    'quantity': int(row['Quantity']) if row['Quantity'] else 0,
                    'fill_price': float(row['FillPrice']) if row['FillPrice'] else 0.0,
                    'open_close': row['OpenClose'],
                    'internal_order_id': row['InternalOrderID'],
                    'parent_id': row['ParentInternalOrderID'],
                    'position_qty': int(row['PositionQuantity']) if row['PositionQuantity'] else 0,
                })
    
    return trades


def match_trades(fills: List[Dict]) -> List[Trade]:
    """Match open and close fills to create complete trades"""
    completed_trades = []
    open_positions = {}  # Track open positions by parent_id or internal_order_id
    
    for fill in fills:
        if fill['open_close'] == 'Open':
            # Opening a new position
            trade = Trade()
            trade.entry_time = fill['datetime']
            trade.direction = 'long' if fill['buy_sell'] == 'Buy' else 'short'
            trade.quantity = fill['quantity']
            trade.entry_price = fill['fill_price']
            trade.internal_order_id = fill['internal_order_id']
            
            # Store by internal order ID to match with close
            open_positions[fill['internal_order_id']] = trade
            
        elif fill['open_close'] == 'Close':
            # Closing a position
            parent_id = fill['parent_id'] if fill['parent_id'] else fill['internal_order_id']
            
            # Try to find the matching open trade
            matching_trade = None
            
            # First try parent_id
            if parent_id and parent_id in open_positions:
                matching_trade = open_positions[parent_id]
            
            # If not found, try to match by direction (opposite) and quantity
            if not matching_trade:
                for order_id, trade in open_positions.items():
                    # Opposite direction and matching quantity
                    expected_direction = 'short' if fill['buy_sell'] == 'Buy' else 'long'
                    if trade.direction == expected_direction:
                        matching_trade = trade
                        break
            
            if matching_trade:
                # Complete the trade
                matching_trade.exit_time = fill['datetime']
                matching_trade.exit_price = fill['fill_price']
                
                # Remove from open positions and add to completed
                if parent_id in open_positions:
                    del open_positions[parent_id]
                else:
                    # Remove by finding it
                    for order_id, trade in list(open_positions.items()):
                        if trade == matching_trade:
                            del open_positions[order_id]
                            break
                
                completed_trades.append(matching_trade)
            else:
                # Orphan close - create a partial trade record
                trade = Trade()
                trade.exit_time = fill['datetime']
                trade.direction = 'short' if fill['buy_sell'] == 'Buy' else 'long'
                trade.quantity = fill['quantity']
                trade.exit_price = fill['fill_price']
                # Leave entry fields as None
    
    # Add any remaining open positions as incomplete trades
    for trade in open_positions.values():
        completed_trades.append(trade)
    
    return completed_trades


def main():
    # Paths
    desktop_path = '/mnt/c/Users/hqdan/OneDrive/Desktop'
    report1 = os.path.join(desktop_path, 'SC-Trade-Report-1.txt')
    report2 = os.path.join(desktop_path, 'SC-Trade-Report-2.txt')
    output_file = os.path.join(desktop_path, 'trade_logs.txt')
    
    print("Converting Sierra Chart trade reports to NQ_Trade_System format...")
    print(f"Reading: {report1}")
    print(f"Reading: {report2}")
    
    # Parse both reports
    fills1 = parse_sc_report(report1)
    fills2 = parse_sc_report(report2)
    
    print(f"Found {len(fills1)} fills in Report 1")
    print(f"Found {len(fills2)} fills in Report 2")
    
    # Combine and sort by datetime
    all_fills = fills1 + fills2
    all_fills.sort(key=lambda x: x['datetime'])
    
    print(f"Total fills: {len(all_fills)}")
    
    # Match opens and closes to create complete trades
    trades = match_trades(all_fills)
    
    print(f"Matched {len(trades)} trades")
    
    # Sort trades by entry time
    trades_with_time = [(t, t.entry_time or t.exit_time) for t in trades if t.entry_time or t.exit_time]
    trades_with_time.sort(key=lambda x: x[1])
    
    # Convert to trade log format
    log_lines = []
    for trade, _ in trades_with_time:
        trade_log = trade.to_trade_log_format()
        if trade_log:
            log_lines.append(trade_log)
    
    # Write to output file
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write('\n'.join(log_lines))
        f.write('\n')
    
    print(f"\nConversion complete!")
    print(f"Output written to: {output_file}")
    print(f"Total trades converted: {len(trades_with_time)}")


if __name__ == '__main__':
    main()

