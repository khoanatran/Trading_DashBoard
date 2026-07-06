# Sierra Chart TradeList Converter

## Overview
This Python script converts Sierra Chart TradeList export files to the `sample_trade_logs.txt` format used by the Trading Dashboard.

## Files
- **Script**: `convert_tradelist.py`
- **Input**: TradeList file exported from Sierra Chart (CSV/TSV format)
- **Output**: `sample_trade_logs.txt` (NQ_Trade_System format)

## Usage

### Basic Usage
```bash
python convert_tradelist.py <input_file>
```

This will create `sample_trade_logs.txt` in the same directory as the input file.

### Specify Output File
```bash
python convert_tradelist.py <input_file> <output_file>
```

### Examples
```bash
# Convert TradeList.csv to sample_trade_logs.txt (default output)
python convert_tradelist.py TradeList.csv

# Convert with custom output filename
python convert_tradelist.py TradeList.csv my_trade_logs.txt

# Convert from different directory
python convert_tradelist.py "C:\Users\YourName\Desktop\TradeList.csv"
```

## Supported File Formats

The converter automatically detects and handles:
- **CSV** (comma-separated)
- **TSV** (tab-separated)
- **Semicolon-separated** files

## Expected Columns

The converter looks for common column name variations:

| Required Data | Column Name Variations |
|--------------|----------------------|
| Entry Price | `Entry Price`, `EntryPrice`, `entry_price` |
| Exit Price | `Exit Price`, `ExitPrice`, `exit_price` |
| Quantity | `Quantity`, `Qty`, `Contracts`, `quantity` |
| Direction | `Direction`, `Side`, `Buy/Sell` (values: long/short, buy/sell, B/S) |
| P&L | `P&L`, `PNL`, `Profit`, `Profit/Loss` |
| Date/Time | `Date`, `Time`, `DateTime`, `Entry Date`, `Entry Time` |
| Risk | `Risk`, `Risk Amount`, `risk_amount` (optional) |
| Stop Loss | `SL`, `Stop Loss`, `Stop`, `sl_points` (optional) |
| Take Profit | `TP`, `Take Profit`, `Target`, `tp_points` (optional) |

## How It Works

1. **Reads the TradeList file** and detects the delimiter (comma, tab, or semicolon)
2. **Normalizes column names** to handle variations in naming
3. **Parses trade data** including:
   - Entry/Exit prices and times
   - Direction (long/short)
   - Quantity (contracts)
   - P&L
   - Risk, SL, TP (if available)
4. **Calculates missing metrics**:
   - If P&L is missing, calculates from price difference
   - If SL points missing, estimates from risk amount
   - If TP points missing, assumes 1:2 R:R ratio
   - Calculates R:R ratio from reward/risk
5. **Converts to trade_logs.txt format** matching the Trading Dashboard format
6. **Writes output file** with all trades in chronological order

## Output Format

The output follows the NQ_Trade_System `trade_logs.txt` format:

```
2025-08-14 09:45:12,523 - === NEW TRADE ===
2025-08-14 09:45:12,523 - Trade timestamp: 2025-08-14 09:45:12.523456
2025-08-14 09:45:12,523 - Direction: long
2025-08-14 09:45:12,523 - Risk amount: $250.00
2025-08-14 09:45:12,523 - SL points: 15.0
2025-08-14 09:45:12,523 - TP points: 30.0
2025-08-14 09:45:12,523 - Order quantity: 4
2025-08-14 09:45:12,523 - Est dollar risked: $120.00
2025-08-14 09:47:33,891 - === TRADE CLOSED ===
2025-08-14 09:47:33,891 - Entry: 19245.50 | Exit: 19260.50
2025-08-14 09:47:33,891 - Risk: 15.0 pts | Reward: 15.00 pts
2025-08-14 09:47:33,891 - R:R Ratio: 1.00R
2025-08-14 09:47:33,891 - P&L: $120.00
```

## Configuration

You can modify these constants in the script:

```python
TICK_VALUE = 0.50  # MNQ: $0.50 per point per contract
DEFAULT_RISK_AMOUNT = 250.0  # Default risk if not specified
```

## Troubleshooting

### "No trades found in file"
- Check that your TradeList file has the expected columns
- Verify the file is CSV/TSV format
- Try opening the file in Excel to see the structure

### "Error parsing file"
- Make sure the file is not corrupted
- Check that the file uses standard CSV/TSV format
- Try saving the file as CSV (UTF-8) from Excel

### Missing or incorrect data
- The converter will estimate missing values (SL, TP, risk)
- Check the output file to verify calculations
- You can manually edit the output file if needed

### Date/Time parsing issues
- Supported formats:
  - `YYYY-MM-DD HH:MM:SS`
  - `MM/DD/YYYY HH:MM:SS`
  - `YYYY-MM-DD`
  - `MM/DD/YYYY`
- If dates aren't parsing correctly, check your TradeList export format

## Using with Trading Dashboard

After conversion:

1. Open the Trading Dashboard:
   ```bash
   npm run dev
   ```

2. Go to http://localhost:3000

3. Click "Upload trade_logs.txt"

4. Select the generated `sample_trade_logs.txt` file

5. View your Sierra Chart trades with full analytics!

## Differences from convert_sc_reports.py

- **convert_sc_reports.py**: Converts Sierra Chart Trade Reports (TSV format with specific columns)
- **convert_tradelist.py**: Converts TradeList exports (more flexible, handles various CSV/TSV formats)

Use `convert_tradelist.py` if you're exporting a TradeList from Sierra Chart's Trade List window.
