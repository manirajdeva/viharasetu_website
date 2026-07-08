#!/usr/bin/env python3
import re
import os

def refactor_file(filename, keep_styles):
    """
    Remove common CSS from HTML file and keep only page-specific styles.
    keep_styles: list of CSS class/id patterns to keep
    """
    with open(filename, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Extract the style section
    style_match = re.search(r'<style>(.*?)</style>', content, re.DOTALL)
    if not style_match:
        print(f"No style tag found in {filename}")
        return
    
    old_style = style_match.group(1)
    
    # Extract only the page-specific CSS rules
    new_style = ""
    
    # For rishikesh and hampi: keep .rishikesh-highlights, .hampi-highlights
    for pattern in keep_styles:
        regex = rf'\.{pattern}.*?(?=\n  \.|$)'
        matches = re.findall(regex, old_style, re.DOTALL)
        for match in matches:
            # Clean up the match
            match_clean = match.strip()
            if match_clean and not match_clean.startswith(':root'):
                new_style += "  " + match_clean + "\n\n"
    
    # Keep media queries that are page-specific
    media_queries = re.findall(r'(@media.*?\n  \})', old_style, re.DOTALL)
    for mq in media_queries:
        # Only keep media queries that reference page-specific classes
        if any(p in mq for p in keep_styles):
            new_style += mq.strip() + "\n\n"
    
    # Replace the entire style section with the minimal version
    new_content = content.replace(
        f'<style>{old_style}</style>',
        f'<style>\n  /* Page-specific styles */\n{new_style}</style>'
    )
    
    with open(filename, 'w', encoding='utf-8') as f:
        f.write(new_content)
    
    print(f"✓ Refactored {filename}")

# Refactor the files
refactor_file('rishikesh.html', ['rishikesh-highlights'])
refactor_file('varanasi.html', ['destination-details'])
print("CSS refactoring complete!")
