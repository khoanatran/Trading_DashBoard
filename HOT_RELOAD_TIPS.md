# Hot Reload Troubleshooting Guide

## Quick Fixes

### 1. **Hard Refresh Browser** (Most Common Fix)
- **Windows/Linux**: `Ctrl + Shift + R` or `Ctrl + F5`
- **Mac**: `Cmd + Shift + R`
- This clears browser cache and forces a full reload

### 2. **Clear Next.js Cache**
```bash
# Stop the server (Ctrl+C), then:
rm -rf .next
npm run dev
```

Or use the batch file:
```bash
CLEAN_DEV.bat
```

### 3. **Check Browser Console**
- Open DevTools (F12)
- Check for errors in Console tab
- Errors can prevent hot reload from working

### 4. **Disable Browser Extensions**
- Some extensions (ad blockers, privacy tools) can interfere
- Try incognito/private mode to test

## Development Best Practices

### ✅ DO:
- Keep the dev server running (`npm run dev`)
- Save files normally - changes should auto-reload
- Use `Ctrl + Shift + R` if changes don't appear
- Check terminal for compilation errors

### ❌ DON'T:
- Don't restart the server unless you see errors
- Don't use `npm run build` during development
- Don't manually refresh unless needed

## When to Restart Server

Only restart (`Ctrl+C` then `npm run dev`) when:
- You see "compilation errors" in terminal
- You add/remove npm packages
- You change `next.config.js` or `tailwind.config.ts`
- Hot reload completely stops working

## Fast Refresh Status

Next.js Fast Refresh should work automatically. If it doesn't:
1. Check terminal for errors
2. Look for "Fast Refresh" messages in browser console
3. Ensure you're not using `export default` incorrectly
4. Make sure components are in `.tsx` files (not `.ts`)

## Browser Settings

### Chrome/Edge:
- Settings → Privacy → Clear browsing data → Cached images and files
- Or use DevTools → Network tab → "Disable cache" (while DevTools open)

### Firefox:
- Settings → Privacy → Clear Data → Cached Web Content

## Still Not Working?

1. **Check file watchers** (Windows):
   - Some antivirus can block file watching
   - Add project folder to exclusions

2. **Check OneDrive sync**:
   - OneDrive can cause file watching issues
   - Try moving project outside OneDrive folder

3. **Use Turbo Mode** (experimental):
   ```bash
   npm run dev:turbo
   ```

4. **Check Node version**:
   ```bash
   node --version
   ```
   Should be 18+ for Next.js 15

