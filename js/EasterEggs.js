import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { getTrackPosition, getTrackLength } from './Track.js';

// Celica GTO Easter Egg
export const CELICA_TRIGGER_DISTANCE = 400; // Appears when leader hits 400m
export const CELICA_SPEED = 25; // m/s - fast!
export const CELICA_LANE = 1.3; // Drives through lanes 1-2

export class CelicaEasterEgg {
    constructor(scene) {
        this.scene = scene;
        this.model = null;
        this.active = false;
        this.distance = 0;
        this.startDistance = 0; // Track where car started
        this.triggered = false;
        this.lapLength = 0;
    }

    load() {
        return new Promise((resolve, reject) => {
            const loader = new FBXLoader();
            loader.load(
                'models/Celica_GTO.fbx',
                (fbx) => {
                    this.model = fbx;
                    this.model.scale.setScalar(0.012);
                    this.model.visible = false;
                    this.scene.add(this.model);
                    console.log('Celica GTO loaded!');
                    resolve(this.model);
                },
                undefined,
                (error) => {
                    console.log('Celica model not loaded:', error);
                    resolve(null); // Don't reject, just continue without the easter egg
                }
            );
        });
    }

    reset() {
        this.triggered = false;
        this.active = false;
        this.startDistance = 0;
        if (this.model) {
            this.model.visible = false;
        }
    }

    trigger(leaderDistance) {
        if (!this.model || this.triggered) return;

        this.triggered = true;
        this.active = true;
        this.distance = leaderDistance - 50; // Start 50m behind leader
        this.startDistance = this.distance; // Remember where we started
        this.lapLength = getTrackLength(CELICA_LANE); // ~400m for a lap
        this.model.visible = true;
        console.log('🚗 CELICA INCOMING! Starting at ' + this.distance.toFixed(0) + 'm, will drive for ' + this.lapLength.toFixed(0) + 'm');
    }

    update(delta, aiRunners) {
        if (!this.active || !this.model) return;

        // Move the car forward FAST
        this.distance += CELICA_SPEED * delta;

        // Position on track
        const pos = getTrackPosition(this.distance, CELICA_LANE);
        this.model.position.set(pos.x, 0, pos.z);

        // Face forward
        const aheadPos = getTrackPosition(this.distance + 5, CELICA_LANE);
        this.model.lookAt(aheadPos.x, 0, aheadPos.z);

        // Check for runners to squish
        for (const runner of aiRunners) {
            if (runner.squished) continue;

            const distDiff = Math.abs(this.distance - runner.distance);
            if (distDiff < 2 && runner.lanePosition < 2.5) {
                runner.squish();
                console.log(`🚗💀 ${runner.raceData.name} got squished!`);
            }
        }

        // Disappear after completing a full lap
        const distanceTraveled = this.distance - this.startDistance;
        if (distanceTraveled >= this.lapLength) {
            this.model.visible = false;
            this.active = false;
            console.log('🚗 Celica completed its lap and drove off!');
        }
    }

    checkTrigger(leaderDistance) {
        if (!this.triggered && leaderDistance >= CELICA_TRIGGER_DISTANCE) {
            this.trigger(leaderDistance);
        }
    }
}
