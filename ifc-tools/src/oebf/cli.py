import click
from pathlib import Path


@click.group()
def cli():
    """OEBF bundle tools: IFC import and export, and bundle validation."""
    pass


@cli.command()
@click.argument("ifc_file", type=click.Path(exists=True))
@click.option("--output", "-o", required=True, help="Output .oebf bundle directory")
def ifc_import(ifc_file, output):
    """Import an IFC file into an OEBF bundle."""
    from .ifc_importer import import_ifc
    import_ifc(Path(ifc_file), Path(output))
    click.echo(f"Imported {ifc_file} → {output}")


@cli.command()
@click.argument("oebf_dir", type=click.Path(exists=True))
@click.option("--output", "-o", required=True, help="Output IFC file path")
def ifc_export(oebf_dir, output):
    """Export an OEBF bundle to IFC."""
    from .ifc_exporter import export_ifc
    export_ifc(Path(oebf_dir), Path(output))
    click.echo(f"Exported {oebf_dir} → {output}")


@cli.command()
@click.argument("oebf_dir", type=click.Path(exists=True))
def validate(oebf_dir):
    """Check a bundle (a folder, or a .oebfz / .oebf.zip archive) against its schemas and cross-references (exit code 1 if anything is wrong)."""
    from .archive import open_bundle, ArchiveError
    from .validate import validate_bundle
    try:
        with open_bundle(Path(oebf_dir)) as folder:
            problems = validate_bundle(folder)
    except ArchiveError as exc:
        click.echo(f"Cannot read {oebf_dir}: {exc}")
        raise SystemExit(1)
    if not problems:
        click.echo(f"No problems found in {oebf_dir}")
        return
    for p in problems:
        click.echo(str(p))
    click.echo(f"{len(problems)} problem(s) in {oebf_dir}")
    raise SystemExit(1)


@cli.command()
@click.argument("archive", type=click.Path(exists=True, dir_okay=False))
@click.argument("dest", required=False, type=click.Path())
def unpack(archive, dest):
    """Unpack a .oebfz (or older .oebf.zip) archive into a bundle folder. DEST defaults to NAME.oebf beside the archive."""
    from .archive import unpack as do_unpack, archive_name, ArchiveError
    dest = Path(dest) if dest else Path(archive).resolve().parent / f"{archive_name(archive)}.oebf"
    try:
        do_unpack(Path(archive), dest)
    except ArchiveError as exc:
        click.echo(f"Not unpacked: {exc}")
        raise SystemExit(1)
    click.echo(f"Unpacked {archive} → {dest}")


@cli.command()
@click.argument("oebf_dir", type=click.Path(exists=True, file_okay=False))
@click.argument("archive", required=False, type=click.Path(dir_okay=False))
def pack(oebf_dir, archive):
    """Pack a bundle folder into a .oebfz archive. ARCHIVE defaults to NAME.oebfz beside the folder."""
    from .archive import pack as do_pack, ArchiveError
    folder = Path(oebf_dir).resolve()
    out = Path(archive) if archive else folder.parent / (folder.name.removesuffix(".oebf") + ".oebfz")
    try:
        do_pack(folder, out)
    except ArchiveError as exc:
        click.echo(f"Not packed: {exc}")
        raise SystemExit(1)
    click.echo(f"Packed {oebf_dir} → {out}")


@cli.command()
@click.argument("oebf_dir", type=click.Path(exists=True, file_okay=False))
@click.argument("commands_file", type=click.Path(exists=True, dir_okay=False))
@click.option("--dry-run", is_flag=True, help="Check the commands and report, without writing anything")
def apply(oebf_dir, commands_file, dry_run):
    """Run a file of commands (see spec/commands.json) on a bundle. Nothing is written if it would leave a new problem."""
    import json
    from .commands import apply_commands, CommandError
    try:
        result = apply_commands(Path(oebf_dir), json.loads(Path(commands_file).read_text()), dry_run=dry_run)
    except (CommandError, json.JSONDecodeError) as exc:
        click.echo(f"Not applied: {exc}")
        raise SystemExit(1)
    for line in result.applied:
        click.echo(line)
    if result.problems:
        for p in result.problems:
            click.echo(str(p))
        click.echo(f"Not applied: the commands would leave {len(result.problems)} new problem(s) in {oebf_dir}")
        raise SystemExit(1)
    click.echo("Checked, nothing written (dry run)" if dry_run else f"Applied {len(result.applied)} command(s) to {oebf_dir}")


if __name__ == "__main__":
    cli()
