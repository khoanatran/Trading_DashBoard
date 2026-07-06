# Sierra Chart to NQ_Trade_System Converter

## Overview
This Python script converts Sierra Chart trade reports into the NQ_Trade_System `trade_logs.txt` format, allowing you to analyze Sierra Chart trades in the Trading Dashboard.

## Files
- **Script**: `convert_sc_reports.py`
- **Input**: SC-Trade-Report files (TSV format from Sierra Chart)
- **Output**: `trade_logs.txt` (NQ_Trade_System format)

## What It Does

The script:
1. Reads multiple Sierra Chart trade report files (TSV format)
2. Parses fill records (opens and closes)
3. Matches entry and exit fills to create complete trades
4. Calculates trade metrics:
   - Entry/Exit prices and times
   - Direction (long/short)
   - Risk and reward in points
   - P&L in dollars
   - R:R ratio
5. Converts to NQ_Trade_System format
6. Merges and sorts all trades chronologically
7. Outputs a single `trade_logs.txt` file

## Usage

### Default Usage (Desktop Files)
The script is configured to read from your Desktop and output there:

```bash
python3 convert_sc_reports.py
```

This will:
- Read: `/mnt/c/Users/hqdan/OneDrive/Desktop/SC-Trade-Report-1.txt`
- Read: `/mnt/c/Users/hqdan/OneDrive/Desktop/SC-Trade-Report-2.txt`
- Write: `/mnt/c/Users/hqdan/OneDrive/Desktop/trade_logs.txt`

### Custom File Paths
To modify file paths, edit the `main()` function in the script:

```python
def main():
    # Change these paths as needed
    desktop_path = '/mnt/c/Users/hqdan/OneDrive/Desktop'
    report1 = os.path.join(desktop_path, 'SC-Trade-Report-1.txt')
    report2 = os.path.join(desktop_path, 'SC-Trade-Report-2.txt')
    output_file = os.path.join(desktop_path, 'trade_logs.txt')
```

## Recent Conversion Results

**Date**: November 16, 2025

**Input Files**:
- SC-Trade-Report-1.txt: 224 fills
- SC-Trade-Report-2.txt: 20 fills
- **Total**: 244 fills

**Output**:
- **102 complete trades** successfully matched and converted
- Output file: 1,215 lines
- Date range: August 14, 2025 - November 14, 2025

## Trade Matching Logic

The script intelligently matches open and close fills:

1. **By Parent Order ID**: Links closes to their parent open orders
2. **By Direction**: Matches opposite directions (Buy close → Sell open, etc.)
3. **Partial Fills**: Handles multiple partial fills for the same order
4. **Orphan Records**: Includes incomplete trades if close/open is missing

## Metric Calculations

### P&L Calculation
- **NQ Point Value**: $0.50 per point per contract
- **Long P&L**: (Exit Price - Entry Price) × Quantity × $0.50
- **Short P&L**: (Entry Price - Exit Price) × Quantity × $0.50

### Risk/Reward Estimation
Since Sierra Chart reports don't include original stop loss and take profit levels:

- **Winners**: Risk estimated as 50% of reward (assumes 1:2 R:R)
- **Losers**: Loss becomes the risk value (R:R = -1.0)

### Price Display
- Sierra Chart prices are in tick format (e.g., 2388600 = 23886.00)
- Converted by dividing by 100 for display

## Output Format

The output follows the NQ_Trade_System format:

```
2025-08-14 15:31:23,369 - === NEW TRADE ===
2025-08-14 15:31:23,369 - Trade timestamp: 2025-08-14  15:31:23.369346
2025-08-14 15:31:23,369 - Direction: short
2025-08-14 15:31:23,369 - Risk amount: $1575.00
2025-08-14 15:31:23,369 - SL points: 1050.0
2025-08-14 15:31:23,369 - TP points: 2100.0
2025-08-14 15:31:23,369 - Order quantity: 3
2025-08-14 15:32:34,921 - === TRADE CLOSED ===
2025-08-14 15:32:34,921 - Entry: 23886.00 | Exit: 23896.50
2025-08-14 15:32:34,921 - Risk: -1050.0 pts | Reward: -1050.0 pts
2025-08-14 15:32:34,921 - R:R Ratio: -1.0R
2025-08-14 15:32:34,921 - P&L: $-1575.00
```

## Using with Trading Dashboard

After conversion:

1. Open the Trading Dashboard:
   ```bash
   cd /home/hqdan/projects/trading-dashboard
   npm run dev
   ```

2. Go to http://localhost:3000

3. Click "Upload trade_logs.txt"

4. Select the generated `trade_logs.txt` from your Desktop

5. View your Sierra Chart trades with full analytics!

## Limitations

- **Risk/Reward**: Estimated from actual results (not from original SL/TP)
- **Partial Fills**: Combines multiple partial fills into single trade entries
- **Commission/Fees**: Not included in P&L calculations
- **Slippage**: Actual fill prices used without adjustment

## Troubleshooting

### "No files found" Error
- Verify your Desktop path in WSL: `/mnt/c/Users/[USERNAME]/OneDrive/Desktop`
- Or use: `/mnt/c/Users/[USERNAME]/Desktop` if not using OneDrive

### Missing Trades
- Check that fills have matching Open/Close records
- Review orphan fills in the console output
- Verify the date range of your reports

### Incorrect Prices
- Ensure report is from NQ futures (not ES, RTY, etc.)
- Check that point value ($0.50) is correct for your instrument

## Adding More Reports

To merge more than 2 reports, modify the script:

```python
# Add more report files
report3 = os.path.join(desktop_path, 'SC-Trade-Report-3.txt')
fills3 = parse_sc_report(report3)

# Combine all
all_fills = fills1 + fills2 + fills3
```

## Support

For issues or questions about the Trading Dashboard or conversion script, check:
- Main README: `/home/hqdan/projects/trading-dashboard/README.md`
- Dashboard: http://localhost:3000 (when running)


