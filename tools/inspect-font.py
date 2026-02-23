import sys
import os

def inspect(path):
    if not os.path.exists(path):
        print(f"File not found: {path}")
        return

    with open(path, 'rb') as f:
        data = f.read()

    print(f"File: {os.path.basename(path)}")
    print(f"Size: {len(data)} bytes")
    print("Head (first 64 bytes):")
    print(data[:64].hex(' '))
    print("-" * 60)

    signatures = {
        b'wOF2': "WOFF2 (77 4f 46 32)",
        b'wOFF': "WOFF (77 4f 46 46)",
        b'\x00\x01\x00\x00': "TTF (00 01 00 00)",
        b'OTTO': "OTF (4f 54 54 4f)"
    }

    found_any = False
    for sig, name in signatures.items():
        start = 0
        while True:
            offset = data.find(sig, start)
            if offset == -1:
                break
            print(f"[FOUND] {name} at offset {offset} (0x{offset:x})")
            found_any = True
            start = offset + 1

    if not found_any:
        print("[FAIL] No known font signature found in ENTIRE file.")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python inspect-font.py <path_to_font>")
    else:
        inspect(sys.argv[1])
