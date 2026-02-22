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
