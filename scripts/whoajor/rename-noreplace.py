#!/usr/bin/env python3
"""Atomically rename one directory without replacing an existing destination."""

import ctypes
import errno
import os
import platform
import sys


AT_FDCWD = -100
RENAME_NOREPLACE = 1
RENAME_EXCL = 0x4


def _rename_darwin(libc, source, target):
    renamex_np = libc.renamex_np
    renamex_np.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
    renamex_np.restype = ctypes.c_int
    return renamex_np(os.fsencode(source), os.fsencode(target), RENAME_EXCL)


def _linux_syscall_number():
    machine = platform.machine().lower()
    return {
        "x86_64": 316,
        "amd64": 316,
        "aarch64": 276,
        "arm64": 276,
        "armv7l": 382,
        "i386": 353,
        "i686": 353,
        "ppc64": 357,
        "ppc64le": 357,
        "s390x": 347,
        "riscv64": 276,
    }.get(machine)


def _rename_linux(libc, source, target):
    source_bytes = os.fsencode(source)
    target_bytes = os.fsencode(target)
    try:
        renameat2 = libc.renameat2
    except AttributeError:
        syscall_number = _linux_syscall_number()
        if syscall_number is None:
            print(
                f"ENOTSUP: renameat2 syscall number is unknown for {platform.machine()}",
                file=sys.stderr,
            )
            return None
        libc.syscall.restype = ctypes.c_long
        return libc.syscall(
            syscall_number,
            AT_FDCWD,
            source_bytes,
            AT_FDCWD,
            target_bytes,
            RENAME_NOREPLACE,
        )
    renameat2.argtypes = [
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_uint,
    ]
    renameat2.restype = ctypes.c_int
    return renameat2(
        AT_FDCWD,
        source_bytes,
        AT_FDCWD,
        target_bytes,
        RENAME_NOREPLACE,
    )


def _print_errno(code, target):
    symbol = errno.errorcode.get(code, "EUNKNOWN")
    if code == errno.EEXIST:
        print(
            f"EEXIST (errno {code}): target already exists: {target}",
            file=sys.stderr,
        )
    else:
        print(
            f"{symbol} (errno {code}): atomic rename failed for target {target}: "
            f"{os.strerror(code)}",
            file=sys.stderr,
        )


def main(argv):
    if len(argv) != 3:
        print("usage: rename-noreplace.py <absolute-source> <absolute-target>", file=sys.stderr)
        return 2
    source, target = argv[1:]
    if not os.path.isabs(source) or not os.path.isabs(target):
        print("EINVAL: source and target must be absolute paths", file=sys.stderr)
        return 2

    libc = ctypes.CDLL(None, use_errno=True)
    system = platform.system()
    if system == "Darwin":
        result = _rename_darwin(libc, source, target)
    elif system == "Linux":
        result = _rename_linux(libc, source, target)
    else:
        print(f"ENOTSUP: atomic no-clobber rename is unsupported on {system}", file=sys.stderr)
        return 2
    if result is None:
        return 2
    if result != 0:
        _print_errno(ctypes.get_errno(), target)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
