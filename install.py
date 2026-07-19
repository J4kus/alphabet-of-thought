"""Build and install a new version of the alphabet-of-thought extension locally.

Usage:
    python install.py            # bump patch version (1.1.3 -> 1.1.4), package, install
    python install.py --minor    # bump minor version (1.1.3 -> 1.2.0)
    python install.py --major    # bump major version (1.1.3 -> 2.0.0)
    python install.py 1.5.0      # set an explicit version
    python install.py --no-bump  # keep the current version
"""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent
PACKAGE_JSON = ROOT / "package.json"


def bump_version(version: str, part: str) -> str:
    major, minor, patch = (int(n) for n in version.split("."))
    if part == "major":
        return f"{major + 1}.0.0"
    if part == "minor":
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"


def run(command: str) -> None:
    print(f"\n> {command}")
    result = subprocess.run(command, shell=True, cwd=ROOT)
    if result.returncode != 0:
        sys.exit(f"Command failed with exit code {result.returncode}")


def main() -> None:
    package = json.loads(PACKAGE_JSON.read_text(encoding="utf-8-sig"))
    current = package["version"]

    arg = sys.argv[1] if len(sys.argv) > 1 else None
    if arg == "--no-bump":
        new_version = current
    elif arg == "--major":
        new_version = bump_version(current, "major")
    elif arg == "--minor":
        new_version = bump_version(current, "minor")
    elif arg:
        new_version = arg
    else:
        new_version = bump_version(current, "patch")

    if new_version != current:
        package["version"] = new_version
        PACKAGE_JSON.write_text(
            json.dumps(package, indent=2) + "\n", encoding="utf-8"
        )
        print(f"Version: {current} -> {new_version}")
    else:
        print(f"Version: {current} (unchanged)")

    run("npx @vscode/vsce package")

    vsix = ROOT / f"alphabet-of-thought-{new_version}.vsix"
    if not vsix.exists():
        sys.exit(f"Expected {vsix.name} but it was not created.")

    run(f'code --install-extension "{vsix}" --force')

    print(
        f"\nInstalled {vsix.name}."
        "\nReload VS Code (Ctrl+Shift+P -> 'Developer: Reload Window') "
        "for the new version to take effect."
    )


if __name__ == "__main__":
    main()
