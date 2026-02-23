import sys
from fontTools.ttLib import TTFont

def deep_check(path):
    print(f"Deep Checking: {path}")
    try:
        font = TTFont(path)
        issues = []

        required = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post']
        for table in required:
            if table not in font:
                issues.append(f"MISSING REQUIRED TABLE: {table}")

        if 'name' in font:
            ps_name = font['name'].getDebugName(6)
            if not ps_name:
                issues.append("MISSING PostScript name (ID 6)")
            elif len(ps_name) > 63:
                issues.append(f"PostScript name too long: {len(ps_name)} chars")
            elif any(c in ps_name for c in " [](){}<>/%"):
                issues.append(f"PostScript name contains invalid characters: '{ps_name}'")

        if 'glyf' in font:
            if '.notdef' not in font.getGlyphOrder():
                issues.append("MISSING .notdef glyph at index 0")
        elif 'CFF ' in font:
            if '.notdef' not in font['CFF '].cff.otFont.getGlyphOrder():
                issues.append("MISSING .notdef glyph in CFF")

        if 'cmap' in font:
            tables = font['cmap'].tables
            if not any(t.isUnicode() for t in tables):
                issues.append("NO UNICODE CMAP TABLE")

        if 'head' in font:
            if font['head'].magicNumber != 0x5F0F3CF5:
                issues.append(f"INVALID MAGIC NUMBER in head: 0x{font['head'].magicNumber:X}")

        if not issues:
            print("No obvious structural issues found that would prevent loading.")
        else:
            print("FOUND ISSUES:")
            for issue in issues:
                print(f"  - {issue}")

    except Exception as e:
        print(f"FATAL ERROR: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python deep_check_font.py <path>")
        sys.exit(1)
    deep_check(sys.argv[1])
