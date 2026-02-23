import sys
from fontTools.ttLib import TTFont

def inspect(path):
    output = []
    output.append(f"Inspecting: {path}")

    try:
        font = TTFont(path)

        if 'fvar' in font:
            output.append("\n--- Variable Font Info (fvar) ---")
            fvar = font['fvar']
            for axis in fvar.axes:
                output.append(f"Axis: {axis.axisTag} (min={axis.minValue}, def={axis.defaultValue}, max={axis.maxValue})")

            output.append(f"\nNamed Instances ({len(fvar.instances)}):")
            for inst in fvar.instances:
                subfamily_id = inst.subfamilyNameID
                name = font['name'].getDebugName(subfamily_id)
                output.append(f"  - {name}: {inst.coordinates}")
        else:
            output.append("\nNo 'fvar' table found (Not a Variable Font or stripped).")

        if 'name' in font:
            output.append("\n--- Name Table ---")
            for record in font['name'].names:
                if record.nameID in [1, 2, 4, 6, 16, 17]:
                    try:
                        val = record.toUnicode()
                        output.append(f"  ID {record.nameID} (p{record.platformID},e{record.platEncID},l{record.langID}): {val}")
                    except Exception:
                        pass

        if 'maxp' in font:
            output.append(f"\n[maxp] numGlyphs: {font['maxp'].numGlyphs}")

        if 'CFF ' in font:
            output.append("Format: OTF (CFF Outlines)")
        elif 'CFF2' in font:
            output.append("Format: OTF (CFF2 Variable Outlines)")
        elif 'glyf' in font:
            output.append("Format: TTF (TrueType Outlines)")

    except Exception as e:
        output.append(f"\n[ERROR] Failed to inspect: {e}")

    try:
        with open('fvar_info.txt', 'w', encoding='utf-8') as f:
            f.write('\n'.join(output))
        print("Output written to fvar_info.txt")
    except Exception as e:
        print(f"Failed to write log: {e}")

    print('\n'.join(output))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python inspect_ttf.py <font_path>")
        sys.exit(1)

    inspect(sys.argv[1])
