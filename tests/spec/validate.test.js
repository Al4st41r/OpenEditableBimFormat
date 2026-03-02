import { test, expect } from "vitest"
import Ajv from "ajv"
import addFormats from "ajv-formats"
import { readFileSync } from "fs"

function loadSchema(name) {
  return JSON.parse(readFileSync(`spec/schema/${name}.schema.json`, "utf8"))
}

function validate(schemaName, data) {
  const ajv = new Ajv({ allErrors: true })
  addFormats(ajv)
  const schema = loadSchema(schemaName)
  const valid = ajv.validate(schema, data)
  return { valid, errors: ajv.errors }
}

test("manifest: valid document passes", () => {
  const doc = {
    format: "oebf",
    format_version: "0.1.0",
    project_name: "Test",
    units: "metres",
    coordinate_system: "right_hand_z_up"
  }
  const { valid, errors } = validate("manifest", doc)
  expect(valid).toBe(true)
})

test("manifest: missing format_version fails", () => {
  const doc = {
    format: "oebf",
    project_name: "Test",
    units: "metres",
    coordinate_system: "right_hand_z_up"
  }
  const { valid } = validate("manifest", doc)
  expect(valid).toBe(false)
})

test("path: valid line segment passes", () => {
  const doc = {
    id: "path-south-wall",
    type: "Path",
    closed: false,
    segments: [{
      type: "line",
      start: { x: 0, y: 0, z: 0 },
      end:   { x: 5, y: 0, z: 0 }
    }]
  }
  const { valid } = validate("path", doc)
  expect(valid).toBe(true)
})

test("path: missing segments fails", () => {
  const doc = { id: "p", type: "Path", closed: false }
  const { valid } = validate("path", doc)
  expect(valid).toBe(false)
})

test("element: valid element passes", () => {
  const doc = {
    id: "element-south-wall",
    type: "Element",
    ifc_type: "IfcWall",
    path_id: "path-south-wall",
    profile_id: "profile-cavity-250",
    sweep_mode: "perpendicular"
  }
  const { valid } = validate("element", doc)
  expect(valid).toBe(true)
})

test("profile: valid profile with assembly passes", () => {
  const doc = {
    id: "profile-cavity-265",
    type: "Profile",
    description: "265mm cavity wall",
    svg_file: "profile-cavity-265.svg",
    width: 0.265,
    height: null,
    origin: { x: 0.0, y: 0.0 },
    alignment: "left-face",
    assembly: [
      { layer: 1, name: "Brick outer leaf",  material_id: "mat-brick",   thickness: 0.102, function: "structure" },
      { layer: 2, name: "Cavity unfilled",   material_id: "mat-air",     thickness: 0.050, function: "service"   },
      { layer: 3, name: "Block inner leaf",  material_id: "mat-block",   thickness: 0.100, function: "structure" },
      { layer: 4, name: "Plaster finish",    material_id: "mat-plaster", thickness: 0.013, function: "finish"    }
    ]
  }
  const { valid } = validate("profile", doc)
  expect(valid).toBe(true)
})

test("profile: missing assembly fails", () => {
  const doc = {
    id: "profile-no-assembly",
    type: "Profile",
    svg_file: "profile.svg",
    origin: { x: 0, y: 0 },
    alignment: "center"
  }
  const { valid } = validate("profile", doc)
  expect(valid).toBe(false)
})

test("profile: layer thickness zero fails", () => {
  const doc = {
    id: "profile-bad-thickness",
    type: "Profile",
    svg_file: "profile.svg",
    origin: { x: 0, y: 0 },
    alignment: "center",
    assembly: [
      { layer: 1, name: "Layer", material_id: "mat-brick", thickness: 0, function: "structure" }
    ]
  }
  const { valid } = validate("profile", doc)
  expect(valid).toBe(false)
})

test("profile: invalid alignment enum fails", () => {
  const doc = {
    id: "profile-bad-align",
    type: "Profile",
    svg_file: "profile.svg",
    origin: { x: 0, y: 0 },
    alignment: "invalid-value",
    assembly: [
      { layer: 1, name: "Layer", material_id: "mat-brick", thickness: 0.100, function: "structure" }
    ]
  }
  const { valid } = validate("profile", doc)
  expect(valid).toBe(false)
})
