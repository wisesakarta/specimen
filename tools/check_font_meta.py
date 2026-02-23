import sys
from fontTools.ttLib import TTFont

def check_metadata(font_path):
    try:
        font = TTFont(font_path)
        name_table = font['name']
        print(f"--- Metadata for: {font_path} ---")
        for record in name_table.names:
            if record.nameID in [1, 2, 4, 5, 6, 8, 9]:
                try:
                    name_str = record.toUnicode()
                    print(f"ID {record.nameID}: {name_str}")
                except Exception:
                    pass

        if 'DSIG' in font:
            print("DSIG table found.")
        else:
            print("DSIG table NOT found.")

        print(f"Glyph count: {len(font.getGlyphOrder())}")
    except Exception as e:
        print(f"Error reading font: {e}")

if __name__ == "__main__":
    check_metadata(sys.argv[1])
