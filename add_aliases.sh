#!/bin/bash
# Add aliases to .bashrc for quick navigation

echo "" >> ~/.bashrc
echo "# Trading Dashboard Project Aliases" >> ~/.bashrc
echo "alias trading=\"cd ~/projects/trading-dashboard\"" >> ~/.bashrc
echo "alias td=\"cd ~/projects/trading-dashboard\"" >> ~/.bashrc
echo "alias trading-dev=\"cd ~/projects/trading-dashboard && npm run dev\"" >> ~/.bashrc
echo "alias trading-install=\"cd ~/projects/trading-dashboard && npm install\"" >> ~/.bashrc

echo "✅ Aliases added to ~/.bashrc"
echo ""
echo "Available aliases:"
echo "  trading       - Navigate to project"
echo "  td            - Short alias for project"
echo "  trading-dev   - Navigate and start dev server"
echo "  trading-install - Navigate and install dependencies"
echo ""
echo "Run 'source ~/.bashrc' to activate immediately"

