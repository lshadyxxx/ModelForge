"""Read-only model-directory probe; portable standard-library payload for a remote channel.

No model imports, code execution, network requests, writes, or credentials. A successful
scan is an observation, not a filesystem snapshot or a runtime compatibility proof.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import unicodedata

METADATA = {"config.json", "model.safetensors.index.json", "pytorch_model.bin.index.json"}


class ProbeError(ValueError):
    pass


def _stamp(value):
    return (value.st_dev, value.st_ino, value.st_mode, value.st_size,
            value.st_mtime_ns, value.st_ctime_ns if os.name != "nt" else 0)


def collect_directory(root, *, max_files=10_000, max_total_bytes=10 * 1024**4,
                      max_metadata_bytes=8 * 1024**2):
    root = Path(root).absolute()
    root_fd = None
    anchored = (os.open in os.supports_dir_fd and os.stat in os.supports_dir_fd
                and os.scandir in os.supports_fd and hasattr(os, 'O_NOFOLLOW'))
    try:
        if '..' in root.parts:
            raise ProbeError('Parent traversal is not supported')
        observed = {}
        def inspect_path_chain():
            for parent in [root, *root.parents]:
                value = parent.lstat()
                if stat.S_ISLNK(value.st_mode) or getattr(value, 'st_file_attributes', 0) & 0x400:
                    raise ProbeError('Linked model directories are not supported')
                identity = (value.st_dev, value.st_ino, value.st_mode)
                if parent in observed and observed[parent] != identity:
                    raise ProbeError('Model directory path changed during verification')
                observed[parent] = identity
        inspect_path_chain()

        def open_root():
            flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
            fd = os.open(root.anchor, flags)
            try:
                current = Path(root.anchor)
                for component in root.parts[1:]:
                    value = os.fstat(fd)
                    if observed[current] != (value.st_dev, value.st_ino, value.st_mode):
                        raise ProbeError('Model directory path changed during verification')
                    child = os.open(component, flags, dir_fd=fd)
                    os.close(fd); fd = child; current = current / component
                value = os.fstat(fd)
                if observed[current] != (value.st_dev, value.st_ino, value.st_mode):
                    raise ProbeError('Model directory path changed during verification')
                return fd
            except BaseException:
                os.close(fd)
                raise

        if anchored:
            root_fd = open_root()
            initial_root = _stamp(os.fstat(root_fd))
        else:
            initial_root = _stamp(root.stat())
        if not stat.S_ISDIR(initial_root[2]):
            raise ProbeError('Model directory is missing')

        def inventory():
            entries = {}
            def visit(directory, prefix=''):
                with os.scandir(directory) as children:
                    for entry in children:
                        name = prefix + entry.name
                        if (len(name.encode('utf-8')) > 1024
                                or any(unicodedata.category(c).startswith('C') for c in name)
                                or chr(92) in name or ':' in name):
                            raise ProbeError('Unsupported model file path')
                        value = (os.stat(entry.name, dir_fd=directory, follow_symlinks=False)
                                 if anchored else Path(entry.path).lstat())
                        if stat.S_ISLNK(value.st_mode) or getattr(value, 'st_file_attributes', 0) & 0x400:
                            raise ProbeError('Linked model files are not supported')
                        if not (stat.S_ISREG(value.st_mode) or stat.S_ISDIR(value.st_mode)):
                            raise ProbeError('Non-regular model file')
                        entries[name] = _stamp(value)
                        if len(entries) > max_files * 4:
                            raise ProbeError('Directory entry limit exceeded')
                        if stat.S_ISDIR(value.st_mode):
                            if anchored:
                                child = os.open(entry.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
                                try:
                                    if _stamp(os.fstat(child)) != entries[name]:
                                        raise ProbeError('Model directory changed during verification')
                                    visit(child, name + '/')
                                finally:
                                    os.close(child)
                            else:
                                visit(Path(entry.path), name + '/')
            visit(root_fd if anchored else root)
            return entries

        before = inventory()
        regular = {name: stamp for name, stamp in before.items() if stat.S_ISREG(stamp[2])}
        if not regular or len(regular) > max_files or sum(s[3] for s in regular.values()) > max_total_bytes:
            raise ProbeError('Empty directory or model scan limit exceeded')
        files, metadata = [], {}
        for name, stamp in sorted(regular.items()):
            if anchored:
                fd = os.dup(root_fd)
                try:
                    for component in name.split('/')[:-1]:
                        child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                        os.close(fd); fd = child
                    handle = os.open(name.split('/')[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
                finally:
                    os.close(fd)
            else:
                handle = os.open(root / name, os.O_RDONLY | getattr(os, 'O_BINARY', 0))
            with os.fdopen(handle, 'rb') as stream:
                if _stamp(os.fstat(stream.fileno())) != stamp:
                    raise ProbeError('Model file changed during verification')
                digest, size, data = hashlib.sha256(), 0, bytearray()
                while chunk := stream.read(1024 * 1024):
                    size += len(chunk)
                    if size > stamp[3]:
                        raise ProbeError('Model file changed during verification')
                    digest.update(chunk)
                    if name in METADATA:
                        if size > max_metadata_bytes:
                            raise ProbeError('Model metadata limit exceeded')
                        data.extend(chunk)
                if size != stamp[3] or _stamp(os.fstat(stream.fileno())) != stamp:
                    raise ProbeError('Model file changed during verification')
            files.append({'path': name, 'size_bytes': size, 'sha256': digest.hexdigest()})
            if name in METADATA:
                metadata[name] = data.decode('utf-8')
        final_root = _stamp(os.fstat(root_fd)) if anchored else _stamp(root.stat())
        if before != inventory() or initial_root != final_root:
            raise ProbeError('Model directory changed during verification')
        inspect_path_chain()
        if anchored:
            final_fd = open_root()
            os.close(final_fd)
        return {'schema_version': 1, 'files': files, 'metadata': metadata}
    except (OSError, UnicodeError, RecursionError) as error:
        raise ProbeError('Cannot read a complete stable model directory') from error
    finally:
        if root_fd is not None:
            os.close(root_fd)


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2:
            raise ProbeError("Expected one model-directory argument")
        print(json.dumps(collect_directory(sys.argv[1]), ensure_ascii=False, separators=(',', ':')))
    except ProbeError as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        raise SystemExit(1)
