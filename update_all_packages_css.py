import re
import os

os.chdir('destinations/All_packages')

files_to_update = [
    'alleppey.html',
    'chardham.html',
    'coorg.html',
    'munnar.html',
    'mysore.html',
    'ooty.html',
    'pondicherry.html',
    'All_packages.html',
    'hampi.html',
    'Explore_Destination.html'
]

for filename in files_to_update:
    if not os.path.exists(filename):
        print(f'✗ File not found: {filename}')
        continue
    
    with open(filename, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Check if already updated
    if 'href="../destinations-common.css"' in content:
        print(f'✓ Already updated: {filename}')
        continue
    
    # Add common CSS link after font link
    if 'href="../destinations-common.css"' not in content:
        # Find the font link and add common CSS after it
        content = content.replace(
            '<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">',
            '<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">\n<link rel="stylesheet" href="../destinations-common.css">'
        )
    
    # For hampi.html, fix the path if needed
    content = content.replace(
        '<link rel="stylesheet" href="destinations-common.css">',
        '<link rel="stylesheet" href="../destinations-common.css">'
    )
    
    # Remove inline style section
    content = re.sub(r'<style>.*?</style>', '', content, flags=re.DOTALL)
    
    with open(filename, 'w', encoding='utf-8') as f:
        f.write(content)
    
    print(f'✓ Updated: {filename}')

print('✓ All files updated successfully!')
