import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { getPosition, getCurrentPathLength } from './Track.js';

// Celica GTO Easter Egg
export const CELICA_TRIGGER_DISTANCE = 400; // Appears when leader hits 400m
export const CELICA_SPEED = 25; // m/s - fast!
export const CELICA_LANE = 7.5; // Drives through outer lanes 7-8


export class CelicaEasterEgg {
    constructor(scene) {
        this.scene = scene;
        this.model = null;
        this.active = false;
        this.distance = 0;
        this.startDistance = 0; // Track where car started
        this.triggered = false;
        this.lapLength = 0;
        this.hasAppeared = false; // Track if car has become visible yet
        this.lapComplete = false; // Track if lap is done
    }

    load() {
        return new Promise((resolve, reject) => {
            const loader = new FBXLoader();
            loader.load(
                'models/Celica_GTO.fbx',
                (fbx) => {
                    // Create a container group for the car
                    this.container = new THREE.Group();
                    this.model = fbx;

                    // Fix the model's base rotation (nose was pointing down)
                    this.model.rotation.x = -Math.PI / 2;
                    this.model.scale.setScalar(1.0);

                    this.container.add(this.model);
                    this.container.visible = false;
                    this.scene.add(this.container);

                    resolve(this.container);
                },
                (progress) => {
                    // Silent progress
                },
                (error) => {
                    console.log('Celica model not found');
                    resolve(null);
                }
            );
        });
    }

    reset() {
        this.triggered = false;
        this.active = false;
        this.startDistance = 0;
        this.hasAppeared = false;
        this.lapComplete = false;
        if (this.container) {
            this.container.visible = false;
        }
    }

    trigger(leaderDistance) {
        if (!this.container || this.triggered) return;

        this.triggered = true;
        this.active = true;
        this.distance = leaderDistance - 50;
        this.startDistance = this.distance;
        this.lapLength = getCurrentPathLength(CELICA_LANE);
        this.hasAppeared = false;
        this.lapComplete = false;
        // Don't make visible yet - wait until out of view
        this.container.visible = false;
    }

    // Check if a position is in the camera's view
    isInCameraView(camera, position) {
        const frustum = new THREE.Frustum();
        const cameraViewProjectionMatrix = new THREE.Matrix4();

        camera.updateMatrixWorld();
        cameraViewProjectionMatrix.multiplyMatrices(
            camera.projectionMatrix,
            camera.matrixWorldInverse
        );
        frustum.setFromProjectionMatrix(cameraViewProjectionMatrix);

        return frustum.containsPoint(position);
    }

    update(delta, aiRunners, camera) {
        if (!this.active || !this.container) return;

        // Move the car forward FAST
        this.distance += CELICA_SPEED * delta;

        // Position on track/city
        const pos = getPosition(this.distance, CELICA_LANE);
        this.container.position.set(pos.x, 0, pos.z);

        // Face forward (container rotates, model inside has fixed rotation)
        const aheadPos = getPosition(this.distance + 5, CELICA_LANE);
        this.container.lookAt(aheadPos.x, 0, aheadPos.z);

        // Check if car is in camera view
        const carPosition = new THREE.Vector3(pos.x, 1, pos.z);
        const inView = this.isInCameraView(camera, carPosition);

        // Only appear when outside user's view
        if (!this.hasAppeared) {
            if (!inView) {
                this.container.visible = true;
                this.hasAppeared = true;
            }
        }

        // Check for runners to squish (only in outer lanes 6+)
        if (this.container.visible) {
            for (const runner of aiRunners) {
                if (runner.squished) continue;

                const distDiff = Math.abs(this.distance - runner.distance);
                if (distDiff < 2 && runner.lanePosition > 6.0) {
                    runner.squish();
                }
            }
        }

        // Check if lap is complete
        const distanceTraveled = this.distance - this.startDistance;
        if (distanceTraveled >= this.lapLength) {
            this.lapComplete = true;
        }

        // Only disappear after lap complete AND out of view
        if (this.lapComplete && !inView) {
            this.container.visible = false;
            this.active = false;
        }
    }

    checkTrigger(leaderDistance) {
        if (!this.triggered && leaderDistance >= CELICA_TRIGGER_DISTANCE) {
            this.trigger(leaderDistance);
        }
    }
}
