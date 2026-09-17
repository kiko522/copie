// Furniture-only experiment: clean color blocks, without pixelation or extra passes.
// Keep the existing geometry normals, alpha cutouts, shadows and emissive details.
export function applyRetroFurniture(material) {
 if (!material.isMeshStandardMaterial) return;
 material.roughness = 0.42;
 material.metalness = 0;
 material.toneMapped = false;
 material.onBeforeCompile = shader => {
  shader.fragmentShader = shader.fragmentShader.replace(
   'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
   `
   vec3 weights = vec3(0.2126, 0.7152, 0.0722);
   float base = max(dot(diffuseColor.rgb, weights), 0.001);
   float illumination = dot(totalDiffuse, weights) / base;
   // Broad, gently joined steps keep curved furniture readable in motion.
   float shade = 0.48
     + 0.18 * smoothstep(0.28, 0.38, illumination)
     + 0.18 * smoothstep(0.55, 0.67, illumination)
     + 0.16 * smoothstep(0.88, 1.02, illumination);
   vec3 shadowTint = mix(vec3(0.88, 0.90, 1.0), vec3(1.0), shade);
   // A restrained white reflection follows the actual lights and camera.
   // Cap it so the broad color blocks do not turn into glossy white plastic.
   float reflection = min(dot(totalSpecular, weights) * 2.5, 0.18);
   vec3 outgoingLight = mix(diffuseColor.rgb * shade * shadowTint, vec3(1.0), reflection) + totalEmissiveRadiance;
   `);
 };
 material.customProgramCacheKey = () => 'retro-furniture-v2';
}
