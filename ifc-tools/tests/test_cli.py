from click.testing import CliRunner
from oebf.cli import cli


def test_cli_shows_help():
    runner = CliRunner()
    result = runner.invoke(cli, ["--help"])
    assert result.exit_code == 0
    assert "import" in result.output
    assert "export" in result.output
