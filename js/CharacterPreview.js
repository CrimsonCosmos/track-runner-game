// CharacterPreview.js - Renders animated 3D character previews for selection screen

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// Character model paths (duplicated from index.html for module access)
const CHARACTER_MODELS = {
    trump: { path: 'public/characters/trump/source/Running.fbx', name: 'Trump' },
    musk: { path: 'public/characters/musk.fbx', name: 'Musk' },
    stalin: { path: 'public/characters/stalin.fbx', name: 'Stalin' },
    skeleton: { path: 'public/characters/skeleton.fbx', name: 'Skeleton' },
    snowman: { path: 'public/characters/snowman.fbx', name: 'Snowman' },
    demon: { path: 'public/characters/demon.fbx', name: 'Demon' },
    default: { path: 'models/Running.fbx', name: 'Default Runner' }
};

// Rotation offsets for models that don't face camera by default
const MODEL_ROTATION_OFFSETS = {
    skeleton: Math.PI,  // Skeleton needs 180 degree rotation to face camera
};

// Scale overrides for models with different internal sizes
const MODEL_SCALE_OVERRIDES = {
    stalin: 0.018,
    demon: 0.008,
    // Default is 0.012 for previews
};

class CharacterPreviewManager {
    constructor() {
        this.previews = new Map();
        this.renderer = null;
        this.clock = new THREE.Clock();
        this.isAnimating = false;
        this.initialized = false;
    }

    init() {
        if (this.initialized) return;

        // Create a shared renderer
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true
        });
        // Use pixel ratio of 1 for consistent canvas sizing when copying to 2D canvas
        this.renderer.setPixelRatio(1);
        this.renderer.setClearColor(0x000000, 0);

        // Initialize previews for each character
        Object.keys(CHARACTER_MODELS).forEach(charId => {
            if (charId === 'default') return; // Skip default for now
            this.createPreview(charId);
        });

        this.initialized = true;
        this.startAnimation();
    }

    createPreview(charId) {
        const container = document.getElementById(`preview-${charId}`);
        if (!container) {
            console.log(`No container found for preview-${charId}`);
            return;
        }

        // Create canvas
        const canvas = document.createElement('canvas');
        canvas.width = 160;  // 2x for retina
        canvas.height = 160;
        container.appendChild(canvas);

        // Create scene
        const scene = new THREE.Scene();

        // Create camera - wider FOV and positioned to see full running character
        const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
        camera.position.set(0, 1.2, 4);
        camera.lookAt(0, 1, 0);

        // Add lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(2, 3, 2);
        scene.add(directionalLight);

        // Add fill light from opposite side
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
        fillLight.position.set(-2, 2, -1);
        scene.add(fillLight);

        // Store preview data
        const previewData = {
            scene,
            camera,
            canvas,
            mixer: null,
            model: null,
            loaded: false
        };
        this.previews.set(charId, previewData);

        // Load the model
        this.loadModel(charId, previewData);
    }

    loadModel(charId, previewData) {
        const modelInfo = CHARACTER_MODELS[charId];
        if (!modelInfo || !modelInfo.path) return;

        const loader = new FBXLoader();
        loader.load(
            modelInfo.path,
            (fbx) => {
                // Scale the model (use character-specific scale or default)
                // Preview default is 0.012, game default is 0.01, so multiply by 1.2
                const baseScale = MODEL_SCALE_OVERRIDES[charId] || 0.01;
                const previewScale = baseScale * 1.2;
                fbx.scale.setScalar(previewScale);

                // Center the model
                const box = new THREE.Box3().setFromObject(fbx);
                const center = box.getCenter(new THREE.Vector3());
                fbx.position.x = -center.x;
                fbx.position.z = -center.z;
                fbx.position.y = -box.min.y; // Ground the model (box is already in world space)

                // Apply rotation offset if needed
                const rotationOffset = MODEL_ROTATION_OFFSETS[charId] || 0;
                fbx.rotation.y = rotationOffset;

                // Fix materials that might be invisible due to missing textures
                fbx.traverse((child) => {
                    if (child.isMesh) {
                        const materials = Array.isArray(child.material) ? child.material : [child.material];
                        materials.forEach(mat => {
                            if (mat) {
                                // If material has no map or map failed to load, ensure it's still visible
                                if (!mat.map || mat.map.image === undefined) {
                                    mat.color = mat.color || new THREE.Color(0x888888);
                                }
                                // Ensure material is not transparent
                                mat.transparent = false;
                                mat.opacity = 1;
                                mat.side = THREE.DoubleSide;
                                mat.needsUpdate = true;
                            }
                        });
                    }
                });

                // Setup animation
                if (fbx.animations.length > 0) {
                    previewData.mixer = new THREE.AnimationMixer(fbx);
                    const action = previewData.mixer.clipAction(fbx.animations[0]);
                    action.play();
                }

                previewData.scene.add(fbx);
                previewData.model = fbx;
                previewData.loaded = true;
            },
            undefined,
            (error) => {
                console.error(`Error loading ${charId} model:`, error);
            }
        );
    }

    startAnimation() {
        if (this.isAnimating) return;
        this.isAnimating = true;
        this.animate();
    }

    stopAnimation() {
        this.isAnimating = false;
    }

    animate() {
        if (!this.isAnimating) return;
        requestAnimationFrame(() => this.animate());

        const delta = this.clock.getDelta();

        // Update all previews
        this.previews.forEach((previewData, charId) => {
            if (!previewData.loaded) return;

            // Update animation
            if (previewData.mixer) {
                previewData.mixer.update(delta);
            }

            // Slowly rotate the model for visual interest
            if (previewData.model) {
                const baseRotation = MODEL_ROTATION_OFFSETS[charId] || 0;
                previewData.model.rotation.y = baseRotation + Math.sin(Date.now() * 0.001) * 0.3;
            }

            // Render to canvas
            this.renderer.setSize(previewData.canvas.width, previewData.canvas.height);
            this.renderer.render(previewData.scene, previewData.camera);

            // Copy to preview canvas
            const ctx = previewData.canvas.getContext('2d');
            ctx.clearRect(0, 0, previewData.canvas.width, previewData.canvas.height);
            ctx.drawImage(this.renderer.domElement, 0, 0);
        });
    }

    dispose() {
        this.stopAnimation();
        this.previews.forEach((previewData) => {
            if (previewData.model) {
                previewData.scene.remove(previewData.model);
                previewData.model.traverse((child) => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                });
            }
        });
        this.previews.clear();
        if (this.renderer) {
            this.renderer.dispose();
        }
        this.initialized = false;
    }
}

// Create singleton instance
const characterPreviewManager = new CharacterPreviewManager();

// Export for module use
export { characterPreviewManager };

// Also expose on window for inline script access
window.initCharacterPreviews = () => characterPreviewManager.init();
window.disposeCharacterPreviews = () => characterPreviewManager.dispose();
