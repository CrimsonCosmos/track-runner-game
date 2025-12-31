// Baton.js - Visual baton for relay races

import * as THREE from 'three';

// Baton dimensions (in meters, roughly accurate)
const BATON_RADIUS = 0.015;  // 3cm diameter
const BATON_LENGTH = 0.30;   // 30cm length

/**
 * Baton class for relay races
 * Creates a golden cylinder mesh that can be attached to a runner's hand
 */
export class Baton {
    constructor(scene) {
        this.scene = scene;

        // Create baton geometry - a simple cylinder
        const geometry = new THREE.CylinderGeometry(
            BATON_RADIUS,
            BATON_RADIUS,
            BATON_LENGTH,
            8 // segments
        );

        // Gold/brass material
        const material = new THREE.MeshStandardMaterial({
            color: 0xFFD700,
            metalness: 0.8,
            roughness: 0.3,
            emissive: 0x332200,
            emissiveIntensity: 0.1
        });

        this.mesh = new THREE.Mesh(geometry, material);

        // Rotate to be held horizontally
        this.mesh.rotation.z = Math.PI / 2;

        // Cast shadows
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = false;

        // Current holder reference
        this.currentHolder = null;
        this.handBone = null;

        // Offset from hand bone
        this.handOffset = new THREE.Vector3(0.05, 0, 0.1);

        // Add to scene
        this.scene.add(this.mesh);
    }

    /**
     * Attach baton to a runner
     * @param {Object} runner - Runner object (should have a model with skeleton)
     */
    attachTo(runner) {
        this.currentHolder = runner;

        // Try to find hand bone in the model's skeleton
        if (runner && runner.model) {
            this.findHandBone(runner.model);
        }
    }

    /**
     * Find the right hand bone in a skinned mesh
     * @param {THREE.Object3D} model - The FBX model
     */
    findHandBone(model) {
        this.handBone = null;

        model.traverse((child) => {
            if (child.isBone) {
                const name = child.name.toLowerCase();
                // Common hand bone names
                if (name.includes('hand') && name.includes('r') ||
                    name.includes('righthand') ||
                    name.includes('hand_r') ||
                    name.includes('r_hand')) {
                    this.handBone = child;
                }
            }
        });

        // If no hand bone found, we'll just position near the runner
        if (!this.handBone) {
            console.log('Baton: No hand bone found, using runner position');
        }
    }

    /**
     * Update baton position to follow holder
     */
    update() {
        if (!this.currentHolder) {
            this.mesh.visible = false;
            return;
        }

        this.mesh.visible = true;

        if (this.handBone) {
            // Position at hand bone
            const worldPos = new THREE.Vector3();
            this.handBone.getWorldPosition(worldPos);

            // Apply offset
            this.mesh.position.copy(worldPos);
            this.mesh.position.add(this.handOffset);

            // Match hand rotation somewhat
            const worldQuat = new THREE.Quaternion();
            this.handBone.getWorldQuaternion(worldQuat);
            this.mesh.quaternion.copy(worldQuat);
            this.mesh.rotateZ(Math.PI / 2); // Keep horizontal
        } else if (this.currentHolder.model) {
            // Fallback: position near the runner's right side
            const pos = this.currentHolder.model.position.clone();
            pos.x += 0.3; // Offset to the right
            pos.y += 1.0; // At about waist height
            this.mesh.position.copy(pos);

            // Match runner's rotation
            this.mesh.rotation.y = this.currentHolder.model.rotation.y;
            this.mesh.rotation.z = Math.PI / 2;
        } else if (this.currentHolder.position) {
            // For player ghost
            const pos = this.currentHolder.position.clone();
            pos.x += 0.3;
            pos.y += 1.0;
            this.mesh.position.copy(pos);
        }
    }

    /**
     * Transfer baton to a new holder
     * @param {Object} newHolder - The new runner to hold the baton
     */
    transferTo(newHolder) {
        this.attachTo(newHolder);
    }

    /**
     * Drop the baton (on failed handoff)
     */
    drop() {
        this.currentHolder = null;
        this.handBone = null;

        // Animate dropping
        // TODO: Add physics/animation for dropped baton
        this.mesh.visible = false;
    }

    /**
     * Show baton
     */
    show() {
        this.mesh.visible = true;
    }

    /**
     * Hide baton
     */
    hide() {
        this.mesh.visible = false;
    }

    /**
     * Dispose of baton resources
     */
    dispose() {
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
        this.scene.remove(this.mesh);
    }

    /**
     * Reset baton state
     */
    reset() {
        this.currentHolder = null;
        this.handBone = null;
        this.mesh.visible = true;
    }
}
