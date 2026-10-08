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
@click.argument("oebf_dir", type=click.Path(exists=True, file_okay=False))
def validate(oebf_dir):
    """Check a bundle against its schemas and cross-references (exit code 1 if anything is wrong)."""
    from .validate import validate_bundle
    problems = validate_bundle(Path(oebf_dir))
    if not problems:
        click.echo(f"No problems found in {oebf_dir}")
        return
    for p in problems:
        click.echo(str(p))
    click.echo(f"{len(problems)} problem(s) in {oebf_dir}")
    raise SystemExit(1)


if __name__ == "__main__":
    cli()
