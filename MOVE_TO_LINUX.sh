#!/bin/bash
# Script to move trading-dashboard to Linux filesystem for better WSL performance

echo "Moving trading-dashboard to Linux filesystem..."
echo ""

# Create projects directory
mkdir -p ~/projects

# Copy project
echo "Copying project to ~/projects/trading-dashboard..."
cp -r /mnt/c/Users/hqdan/OneDrive/Desktop/NQ_Trade_System/trading-dashboard ~/projects/trading-dashboard

# Navigate to new location
cd ~/projects/trading-dashboard

echo ""
echo "✅ Project moved successfully!"
echo ""
echo "New location: ~/projects/trading-dashboard"
echo "Windows path: \\\\wsl$\\Ubuntu\\home\\hqdan\\projects\\trading-dashboard"
echo ""
echo "Next steps:"
echo "1. cd ~/projects/trading-dashboard"
echo "2. npm install"
echo "3. npm run dev"
echo ""

