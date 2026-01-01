// CharacterPreview.js - Renders 3D character previews sequentially to avoid memory issues

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// Character model paths
const CHARACTER_MODELS = {
    trump: { path: 'public/characters/trump/source/Running.fbx', name: 'Trump' },
    musk: { path: 'public/characters/musk.fbx', name: 'Musk' },
    stalin: { path: 'public/characters/stalin/source/model.fbx', name: 'Stalin' },
    skeleton: { path: 'public/characters/skeleton.fbx', name: 'Skeleton' },
    snowman: { path: 'public/characters/snowman.fbx', name: 'Snowman' },
};

// Rotation offsets for models that don't face camera by default
const MODEL_ROTATION_OFFSETS = {
    skeleton: Math.PI,
    trump: -Math.PI / 2,
    musk: -Math.PI / 2,
    snowman: -Math.PI / 2,
};

// Scale overrides
const MODEL_SCALE_OVERRIDES = {
    // Default is 0.01
};

class CharacterPreviewManager {
    constructor() {
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.initialized = false;
        this.currentModel = null;
        this.mixer = null;
    }

    init() {
        if (this.initialized) return;
        this.initialized = true;

        // Create shared renderer, scene, camera
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(1);
        this.renderer.setSize(160, 160);
        this.renderer.setClearColor(0x000000, 0);

        this.scene = new THREE.Scene();

        this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
        this.camera.position.set(0, 1.2, 4);
        this.camera.lookAt(0, 1, 0);

        // Lights
        const ambient = new THREE.AmbientLight(0xffffff, 0.8);
        this.scene.add(ambient);
        const dir = new THREE.DirectionalLight(0xffffff, 0.8);
        dir.position.set(2, 3, 2);
        this.scene.add(dir);
        const fill = new THREE.DirectionalLight(0xffffff, 0.4);
        fill.position.set(-2, 2, -1);
        this.scene.add(fill);

        // Load previews sequentially
        this.loadPreviewsSequentially();
    }

    async loadPreviewsSequentially() {
        const charIds = Object.keys(CHARACTER_MODELS);

        for (const charId of charIds) {
            const container = document.getElementById(`preview-${charId}`);
            if (!container) continue;

            console.log(`[Preview] Loading ${charId}...`);

            try {
                await this.loadAndRenderPreview(charId, container);
                console.log(`[Preview] ${charId} done`);
            } catch (err) {
                console.error(`[Preview] ${charId} failed:`, err);
            }

            // Small delay between loads to let browser breathe
            await new Promise(r => setTimeout(r, 100));
        }

        // Clean up renderer after all previews done
        this.dispose();
    }

    loadAndRenderPreview(charId, container) {
        return new Promise((resolve, reject) => {
            const modelInfo = CHARACTER_MODELS[charId];
            if (!modelInfo || !modelInfo.path) {
                reject(new Error('No model path'));
                return;
            }

            const loader = new FBXLoader();
            loader.load(
                modelInfo.path,
                (fbx) => {
                    // Clear previous model
                    this.clearModel();

                    // Scale
                    const scale = (MODEL_SCALE_OVERRIDES[charId] || 0.01) * 1.2;
                    fbx.scale.setScalar(scale);

                    // Center and ground
                    const box = new THREE.Box3().setFromObject(fbx);
                    const center = box.getCenter(new THREE.Vector3());
                    const size = box.getSize(new THREE.Vector3());

                    console.log(`[Preview] ${charId} size: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`);

                    fbx.position.x = -center.x;
                    fbx.position.z = -center.z;
                    fbx.position.y = -box.min.y;

                    // Rotation
                    fbx.rotation.y = MODEL_ROTATION_OFFSETS[charId] || 0;

                    // Fix materials
                    fbx.traverse((child) => {
                        if (child.isMesh) {
                            const mats = Array.isArray(child.material) ? child.material : [child.material];
                            mats.forEach(mat => {
                                if (mat) {
                                    if (!mat.map || !mat.map.image) {
                                        mat.color = mat.color || new THREE.Color(0x888888);
                                    }
                                    mat.transparent = false;
                                    mat.opacity = 1;
                                    mat.side = THREE.DoubleSide;
                                    mat.needsUpdate = true;
                                }
                            });
                        }
                    });

                    // Play animation for one frame
                    if (fbx.animations.length > 0) {
                        this.mixer = new THREE.AnimationMixer(fbx);
                        const action = this.mixer.clipAction(fbx.animations[0]);
                        action.play();
                        this.mixer.update(0.5); // Advance to a good pose
                    }

                    this.scene.add(fbx);
                    this.currentModel = fbx;

                    // Render to canvas
                    this.renderer.render(this.scene, this.camera);

                    // Create static canvas and copy rendered image
                    const canvas = document.createElement('canvas');
                    canvas.width = 160;
                    canvas.height = 160;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(this.renderer.domElement, 0, 0);

                    // Add to container
                    container.innerHTML = '';
                    canvas.style.width = '100%';
                    canvas.style.height = '100%';
                    canvas.style.borderRadius = '8px';
                    container.appendChild(canvas);

                    // Clear model from memory
                    this.clearModel();

                    resolve();
                },
                undefined,
                (error) => {
                    console.error(`[Preview] Error loading ${charId}:`, error);
                    reject(error);
                }
            );
        });
    }

    clearModel() {
        if (this.currentModel) {
            this.scene.remove(this.currentModel);
            this.currentModel.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                    mats.forEach(m => {
                        if (m.map) m.map.dispose();
                        m.dispose();
                    });
                }
            });
            this.currentModel = null;
        }
        if (this.mixer) {
            this.mixer = null;
        }
    }

    dispose() {
        this.clearModel();
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
        }
        this.scene = null;
        this.camera = null;
        console.log('[Preview] Disposed all resources');
    }
}

// Singleton
const characterPreviewManager = new CharacterPreviewManager();

export { characterPreviewManager };

window.initCharacterPreviews = () => characterPreviewManager.init();
window.disposeCharacterPreviews = () => characterPreviewManager.dispose();
