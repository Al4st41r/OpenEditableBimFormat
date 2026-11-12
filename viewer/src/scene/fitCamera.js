/**
 * fitCamera.js — Frame a model in the 3D and plan cameras (#159).
 *
 * The 3D view stands back along a viewing direction until the model's bounding sphere fits the narrower of the two
 * fields of view, so the whole model is in view at any aspect and from any angle. The plan view centres on the
 * model's footprint and zooms until it fills the frame.
 */

import * as THREE from 'three';

/** The opening viewing direction, from the model towards the camera: from the south-east, above (Z-up). */
export const DEFAULT_VIEW_DIRECTION = Object.freeze(new THREE.Vector3(1, -1, 0.8).normalize());

/** The frame left round the model, as a factor on its size. */
export const FIT_MARGIN = 1.1;

/**
 * Move a perspective camera so the sphere fills its view, looking at the sphere's centre.
 *
 * @param {THREE.PerspectiveCamera} camera
 * @param {THREE.Vector3} target - the orbit target (OrbitControls.target), set to the centre
 * @param {THREE.Sphere} sphere
 * @param {THREE.Vector3} [direction] - from the centre towards the camera; the default when zero or missing
 */
export function fitPerspective(camera, target, sphere, direction = DEFAULT_VIEW_DIRECTION) {
  const dir = direction.lengthSq() > 1e-12 ? direction.clone().normalize() : DEFAULT_VIEW_DIRECTION.clone();
  const vHalf = THREE.MathUtils.degToRad(camera.fov) / 2;
  const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
  const radius = Math.max(sphere.radius, 0.5) * FIT_MARGIN;   // a lone post still gets a sensible view
  const distance = radius / Math.sin(Math.min(vHalf, hHalf));
  target.copy(sphere.center);
  camera.position.copy(sphere.center).addScaledVector(dir, distance);
  if (camera.far < distance + radius * 2) camera.far = distance + radius * 2;   // a large site must not be clipped
  camera.updateProjectionMatrix();
}

/**
 * Centre a plan (orthographic, looking down Z with Y up) camera on the box's footprint and zoom to fit it.
 *
 * @param {THREE.OrthographicCamera} camera
 * @param {THREE.Vector3} target - the pan target (OrbitControls.target), set below the camera
 * @param {THREE.Box3} box
 */
export function fitPlan(camera, target, box) {
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const halfW = Math.max(size.x / 2, 0.5) * FIT_MARGIN;
  const halfH = Math.max(size.y / 2, 0.5) * FIT_MARGIN;
  camera.zoom = Math.min((camera.right - camera.left) / 2 / halfW, (camera.top - camera.bottom) / 2 / halfH);
  camera.position.set(centre.x, centre.y, Math.max(camera.position.z, box.max.z + 10));   // above the tallest part
  target.set(centre.x, centre.y, 0);
  camera.updateProjectionMatrix();
}
