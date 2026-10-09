import importlib.util
import shutil
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILDER = ROOT / "tools" / "build_release.py"


def load_builder():
    spec = importlib.util.spec_from_file_location("build_release_npm_launcher", BUILDER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load the release builder from {BUILDER}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _StopBeforeSpawn(Exception):
    """Raised by the stubbed runner so the real npm is never executed."""


class ReleaseBuilderLauncherTests(unittest.TestCase):
    def test_fetch_missing_archive_invokes_npm_through_its_resolved_launcher(self):
        builder = load_builder()
        launcher = shutil.which("npm")
        if launcher is None:
            self.skipTest("npm is unavailable on this host")

        captured = []

        def fake_run(argv, **kwargs):
            captured.append(list(argv))
            raise _StopBeforeSpawn()

        original = builder.subprocess.run
        builder.subprocess.run = fake_run
        try:
            with self.assertRaises(_StopBeforeSpawn):
                builder.fetch_missing_archive(
                    "sharp", "0.35.5", Path("target.tgz"), Path(".")
                )
        finally:
            builder.subprocess.run = original

        self.assertEqual(len(captured), 1)
        argv = captured[0]
        self.assertEqual(
            argv[0],
            launcher,
            "npm must be spawned through its resolved launcher path",
        )
        self.assertEqual(argv[1:3], ["pack", "sharp@0.35.5"])
        self.assertEqual(argv[3], "--pack-destination")
        self.assertNotEqual(
            argv[0], "npm", "the bare npm name cannot be resolved on Windows"
        )


if __name__ == "__main__":
    unittest.main()
