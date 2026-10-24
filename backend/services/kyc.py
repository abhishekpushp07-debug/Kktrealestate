import hashlib
import hmac
import os
import re

from crypto import decrypt_field, encrypt_field

PAN_RX = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
IFSC_RX = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")
PHONE_RX = re.compile(r"^[6-9][0-9]{9}$")

_D = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
      [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1], [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
      [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]]
_P = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
      [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1], [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]]
_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9]


def verhoeff_valid(num: str) -> bool:
    c = 0
    for i, ch in enumerate(reversed(num)):
        c = _D[c][_P[i % 8][int(ch)]]
    return c == 0


def verhoeff_generate(num11: str) -> str:
    c = 0
    for i, ch in enumerate(reversed(num11)):
        c = _D[c][_P[(i + 1) % 8][int(ch)]]
    return num11 + str(_INV[c])


def normalize_phone(phone: str | None) -> str | None:
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    if digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    if digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]
    if not PHONE_RX.match(digits):
        raise ValueError("Phone must be a valid 10-digit Indian mobile number")
    return "+91" + digits


def validate_pan(pan: str | None) -> str | None:
    if not pan:
        return None
    pan = pan.strip().upper()
    if not PAN_RX.match(pan):
        raise ValueError("PAN must match AAAAA9999A")
    return pan


def validate_aadhaar(a: str | None) -> str | None:
    if not a:
        return None
    digits = re.sub(r"\D", "", a)
    if len(digits) != 12 or digits[0] in "01" or not verhoeff_valid(digits):
        raise ValueError("Aadhaar must be 12 digits with a valid checksum")
    return digits


def validate_ifsc(ifsc: str | None) -> str | None:
    if not ifsc:
        return None
    ifsc = ifsc.strip().upper()
    if not IFSC_RX.match(ifsc):
        raise ValueError("IFSC must match AAAA0XXXXXX")
    return ifsc


def secure_hash(value: str | None) -> str | None:
    if not value:
        return None
    return hmac.new(os.environ["ENCRYPTION_KEY"].encode(), value.encode(), hashlib.sha256).hexdigest()


def mask_pan(pan: str | None) -> str | None:
    return f"XXXXX{pan[5:9]}{pan[9]}" if pan and len(pan) == 10 else None


def mask_aadhaar(a: str | None) -> str | None:
    return f"XXXX XXXX {a[-4:]}" if a and len(a) == 12 else None


def mask_account(acc: str | None) -> str | None:
    return f"{'X' * max(len(acc) - 4, 0)}{acc[-4:]}" if acc else None


SENSITIVE = {"pan": mask_pan, "aadhaar": mask_aadhaar, "account_number": mask_account}


def seal(data: dict, fields=("pan", "aadhaar")) -> dict:
    """Replace plaintext sensitive fields with *_enc (+ pan_hash)."""
    out = dict(data)
    for f in fields:
        if f in out:
            val = out.pop(f)
            if val is not None:
                out[f"{f}_enc"] = encrypt_field(val)
                if f == "pan":
                    out["pan_hash"] = secure_hash(val)
            else:
                out[f"{f}_enc"] = None
                if f == "pan":
                    out["pan_hash"] = None
    return out


def unseal(doc: dict, reveal: bool, fields=("pan", "aadhaar")) -> dict:
    out = dict(doc)
    for f in fields:
        enc = out.pop(f"{f}_enc", None)
        plain = decrypt_field(enc)
        out[f"{f}_masked"] = SENSITIVE[f](plain)
        out[f] = plain if reveal else None
    out.pop("pan_hash", None)
    return out
