# Moving Project Outside OneDrive

## Option 1: Move to C:\dev\projects (Recommended for WSL)

### From Windows PowerShell (as Administrator):
```powershell
# Create destination folder
New-Item -ItemType Directory -Force -Path "C:\dev\projects"

# Move the entire NQ_Trade_System folder
Move-Item -Path "$env:USERPROFILE\OneDrive\Desktop\NQ_Trade_System" -Destination "C:\dev\projects\NQ_Trade_System" -Force

# Or just move trading-dashboard
Move-Item -Path "$env:USERPROFILE\OneDrive\Desktop\NQ_Trade_System\trading-dashboard" -Destination "C:\dev\projects\trading-dashboard" -Force
```

### From WSL:
```bash
# Create destination
mkdir -p /mnt/c/dev/projects

# Move project (choose one):
# Option A: Move entire NQ_Trade_System
mv /mnt/c/Users/hqdan/OneDrive/Desktop/NQ_Trade_System /mnt/c/dev/projects/

# Option B: Move just trading-dashboard
mv /mnt/c/Users/hqdan/OneDrive/Desktop/NQ_Trade_System/trading-dashboard /mnt/c/dev/projects/
```

## Option 2: Move to WSL Linux Filesystem (Best Performance)

### From WSL:
```bash
# Create projects folder in home directory
mkdir -p ~/projects

# Copy project to Linux filesystem (faster than Windows filesystem)
cp -r /mnt/c/Users/hqdan/OneDrive/Desktop/NQ_Trade_System/trading-dashboard ~/projects/trading-dashboard

# Navigate to project
cd ~/projects/trading-dashboard

# Install dependencies
npm install

# Run dev server
npm run dev
```

**Note**: When using Linux filesystem, access from Windows at: `\\wsl$\Ubuntu\home\hqdan\projects\trading-dashboard`

## Option 3: Move to C:\Users\hqdan\Documents (Simple)

### From Windows:
```powershell
# Create projects folder
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\Documents\projects"

# Move project
Move-Item -Path "$env:USERPROFILE\OneDrive\Desktop\NQ_Trade_System\trading-dashboard" -Destination "$env:USERPROFILE\Documents\projects\trading-dashboard" -Force
```

## After Moving:

1. **Navigate to new location**:
   ```bash
   # If moved to C:\dev\projects
   cd /mnt/c/dev/projects/trading-dashboard
   
   # If moved to Linux filesystem
   cd ~/projects/trading-dashboard
   ```

2. **Reinstall dependencies** (if needed):
   ```bash
   npm install
   ```

3. **Start dev server**:
   ```bash
   npm run dev
   ```

4. **Update any shortcuts/batch files** to point to new location

## Recommended: Use Linux Filesystem for Best Performance

For WSL development, the Linux filesystem (`~/projects/`) is fastest because:
- ✅ No OneDrive sync interference
- ✅ Better file watching performance
- ✅ Faster npm/node operations
- ✅ Native Linux file system

Access from Windows Explorer: `\\wsl$\Ubuntu\home\hqdan\projects\trading-dashboard`

