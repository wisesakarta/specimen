#!/usr/bin/env python3
"""
SVELGE - Font Intelligence & Selection Engine
Filters, analyzes, and selects targeted fonts from captured data
"""

import sys
import json
import hashlib
from collections import defaultdict
from typing import Dict, List, Set, Tuple, Optional
from fontTools.ttLib import TTFont

# Font signatures we want to target (can be extended)
TARGET_WEIGHTS = {
    'thin': 250,
    'hairline': 250,
    'extralight': 275,
    'ultralight': 275,
    'light': 300,
    'regular': 400,
    'normal': 400,
    'medium': 500,
    'semibold': 600,
    'demibold': 600,
    'bold': 700,
    'extrabold': 800,
    'ultrabold': 800,
    'black': 900,
    'heavy': 900,
}

TARGET_STYLES = ['regular', 'italic', 'oblique', 'bold', 'bolditalic']

def analyze_font_buffer(buffer: bytes) -> Optional[Dict]:
    """Analyze font buffer and extract metadata at binary level"""
    try:
        import io
        font = TTFont(io.BytesIO(buffer))
        
        # Get name table
        names = font['name'].names
        
        def get_name(name_id: int) -> str:
            for record in names:
                if record.nameID == name_id:
                    try:
                        return record.toUnicode()
                    except:
                        continue
            return ""
        
        family = get_name(1) or get_name(16)
        subfamily = get_name(2) or get_name(17)
        full_name = get_name(4)
        postscript = get_name(6)
        
        # Get OS/2 weight
        weight = 400
        if 'OS/2' in font:
            weight = font['OS/2'].usWeightClass
        
        # Get glyph count
        glyph_count = len(font.getGlyphSet())
        
        # Check if it's a variable font
        is_variable = 'fvar' in font
        
        # Calculate unique unicode coverage
        unicode_coverage = set()
        if 'cmap' in font:
            for table in font['cmap'].tables:
                if hasattr(table, 'cmap'):
                    unicode_coverage.update(table.cmap.keys())
        
        return {
            'family': family.strip() if family else '',
            'subfamily': subfamily.strip() if subfamily else 'Regular',
            'full_name': full_name.strip() if full_name else '',
            'postscript': postscript.strip() if postscript else '',
            'weight': weight,
            'glyph_count': glyph_count,
            'is_variable': is_variable,
            'unicode_coverage': len(unicode_coverage),
            'is_complete': glyph_count > 500,  # Heuristic: complete fonts have 500+ glyphs
        }
    except Exception as e:
        return None

def calculate_font_hash(buffer: bytes) -> str:
    """Calculate unique hash for font content"""
    return hashlib.md5(buffer[:1000]).hexdigest()[:8]

def is_chunk_font(font_info: Dict) -> bool:
    """Determine if font is likely a chunk/subset"""
    # Small glyph count suggests chunk
    if font_info['glyph_count'] < 200:
        return True
    # Low unicode coverage suggests chunk
    if font_info['unicode_coverage'] < 100:
        return True
    return False

def group_fonts_by_family(fonts: List[Dict]) -> Dict[str, List[Dict]]:
    """Group fonts by their family name"""
    groups = defaultdict(list)
    
    for font in fonts:
        family = font.get('family', '') or font.get('full_name', '')
        if not family:
            # Use URL-based fallback
            family = 'unknown'
        
        # Normalize family name
        family = family.lower().replace(' ', '-').replace('_', '-')
        groups[family].append(font)
    
    return dict(groups)

def select_best_fonts(fonts: List[Dict], target_family: str = None) -> List[Dict]:
    """
    Select the best fonts from a list
    Prioritize complete fonts over chunks
    """
    if not fonts:
        return []
    
    # Separate complete fonts from chunks
    complete = [f for f in fonts if f.get('is_complete', True)]
    chunks = [f for f in fonts if not f.get('is_complete', True)]
    
    # If we have complete fonts, use those
    # If we only have chunks, we'll need to merge them
    selected = []
    
    # Group by subfamily/style
    by_style = defaultdict(list)
    for f in complete:
        style = f.get('subfamily', 'Regular')
        by_style[style].append(f)
    
    # For each style, pick the one with most glyphs
    for style, style_fonts in by_style.items():
        best = max(style_fonts, key=lambda x: x.get('glyph_count', 0))
        selected.append(best)
    
    # If no complete fonts, return chunks (will be merged later)
    if not selected:
        selected = chunks
    
    return selected

def filter_fonts(fonts: List[Dict], target_family: str = None, target_styles: List[str] = None) -> List[Dict]:
    """
    Filter fonts based on target criteria
    """
    filtered = []
    
    for font in fonts:
        family = font.get('family', '').lower()
        subfamily = font.get('subfamily', 'Regular').lower()
        
        # If target family specified, match it
        if target_family:
            target_lower = target_family.lower()
            if target_lower not in family:
                # Check if it's a variant of target
                if not any(t in family for t in target_lower.split()):
                    continue
        
        # If target styles specified, match them
        if target_styles:
            style_match = False
            for target in target_styles:
                if target.lower() in subfamily:
                    style_match = True
                    break
            if not style_match:
                # Also check full name
                full_name = font.get('full_name', '').lower()
                if not any(t.lower() in full_name for t in target_styles):
                    continue
        
        filtered.append(font)
    
    return filtered

def process_fonts(font_buffers: List[Tuple[str, bytes]], options: Dict = None) -> Dict:
    """
    Main processing function
    Analyzes font buffers and returns organized results
    """
    options = options or {}
    target_family = options.get('target_family')
    target_styles = options.get('target_styles', ['regular', 'bold', 'italic'])
    
    analyzed = []
    
    # Analyze each font buffer
    for url, buffer in font_buffers:
        info = analyze_font_buffer(buffer)
        if info:
            info['url'] = url
            info['hash'] = calculate_font_hash(buffer)
            info['size'] = len(buffer)
            info['is_chunk'] = is_chunk_font(info)
            analyzed.append(info)
    
    # Group by family
    family_groups = group_fonts_by_family(analyzed)
    
    # Process each family group
    results = {
        'fonts': [],
        'chunks': [],
        'groups': {},
        'summary': {
            'total': len(analyzed),
            'complete': 0,
            'chunks': 0,
            'families': len(family_groups)
        }
    }
    
    for family, family_fonts in family_groups.items():
        # Filter by target criteria
        if target_family or target_styles:
            family_fonts = filter_fonts(family_fonts, target_family, target_styles)
        
        if not family_fonts:
            continue
        
        # Select best fonts (prioritize complete)
        selected = select_best_fonts(family_fonts, target_family)
        
        results['groups'][family] = {
            'count': len(family_fonts),
            'selected': len(selected),
            'fonts': selected
        }
        
        for font in selected:
            if font.get('is_chunk'):
                results['chunks'].append(font)
                results['summary']['chunks'] += 1
            else:
                results['fonts'].append(font)
                results['summary']['complete'] += 1
    
    return results

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='SVELGE - Font Intelligence')
    parser.add_argument('--input', required=True, help='Input JSON file with fonts')
    parser.add_argument('--target-family', help='Target font family')
    parser.add_argument('--target-styles', nargs='+', default=['regular', 'bold', 'italic'],
                        help='Target styles')
    parser.add_argument('--output', help='Output JSON file')
    
    args = parser.parse_args()
    
    # Read input
    with open(args.input, 'r') as f:
        data = json.load(f)
    
    # Process fonts
    fonts = [(item['url'], bytes(item['buffer'])) for item in data]
    results = process_fonts(fonts, {
        'target_family': args.target_family,
        'target_styles': args.target_styles
    })
    
    # Output
    output = json.dumps(results, indent=2)
    if args.output:
        with open(args.output, 'w') as f:
            f.write(output)
    else:
        print(output)

if __name__ == '__main__':
    main()
