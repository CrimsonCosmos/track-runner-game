import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// Import game modules
import {
    STRAIGHT_LENGTH, INNER_RADIUS, LANE_WIDTH, NUM_LANES, TRACK_WIDTH,
    getPosition, getTrackLength, buildTrack, trackObjects, setPathMode,
    getMountainRoadsWaypoints, setMountainRoadsGroundHeights
} from './Track.js';

import {
    Runner, RUNNER_COLORS, RACE_DATA, shuffleArray,
    DRIFT_LEFT_SPEED, MIN_LANE_POSITION, MAX_LANE_POSITION
} from './Runner.js';

import { Player, formatPace } from './Player.js';

import {
    createRaceClock, updateClockDisplay, playLastLapBell, getDistanceToLeader,
    resolveCollisions, formatTime,
    LANE_FORMATION, getFormation, setupLaneStart, getStaggeredStartDistance
} from './Race.js';

import { CelicaEasterEgg, CELICA_TRIGGER_DISTANCE } from './EasterEggs.js';

// Race mode imports
import { RACE_MODES, RACE_MODE, INPUT_TYPE, ENERGY_TYPE, getRaceDistance, getCurrentLap, isInKickPhase } from './RaceConfig.js';
import { InputManager } from './InputManager.js';
import { createEnergySystem } from './EnergySystem.js';
import { RelayManager } from './RelayManager.js';
import { getScoreboard } from './Scoreboard.js';
import { GhostManager } from './GhostRunner.js';
import { createExchangeZoneUI, updateExchangeZoneUI } from './ExchangeZone.js';
import { getCityPathLength, getCityStreetPosition } from './Track.js';
import { getNetworkManager } from './NetworkManager.js';
import './CharacterPreview.js'; // Character selection 3D previews

// ============================================
// SCENE SETUP
// ============================================

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);
scene.fog = new THREE.Fog(0x87CEEB, 100, 400);

// Camera
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

// ============================================
// LIGHTING
// ============================================

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffffd0, 1.2);
sunLight.position.set(50, 100, 30);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 10;
sunLight.shadow.camera.far = 300;
sunLight.shadow.camera.left = -100;
sunLight.shadow.camera.right = 100;
sunLight.shadow.camera.top = 100;
sunLight.shadow.camera.bottom = -100;
scene.add(sunLight);

const hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x3d5c3d, 0.4);
scene.add(hemiLight);

// ============================================
// BUILD TRACK
// ============================================

buildTrack(scene);
createRaceClock(scene, STRAIGHT_LENGTH, INNER_RADIUS, TRACK_WIDTH);

// ============================================
// TRACK VIEWS (Default / Mountain)
// ============================================

let currentView = 'default';
const mountainObjects = [];
const cloudObjects = [];
const treeObjects = [];
const cityObjects = [];
let cityLoaded = false;
const mountainRoadsObjects = [];
let mountainRoadsLoaded = false;
let mountainRoadsModel = null;
let mountainRoadsGroundHeights = []; // Pre-calculated ground heights for each waypoint

function createMountains() {
    // Simple cone mountains around the track
    const mountainMaterial = new THREE.MeshStandardMaterial({
        color: 0x6b8e6b,
        roughness: 0.9,
        metalness: 0.1,
    });

    const snowMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.6,
        metalness: 0.0,
    });

    // Mountain positions around the track
    const mountains = [
        { x: -200, z: -200, height: 150, radius: 80 },
        { x: 0, z: -250, height: 200, radius: 100 },
        { x: 200, z: -200, height: 170, radius: 90 },
        { x: 280, z: 0, height: 180, radius: 95 },
        { x: 200, z: 200, height: 160, radius: 85 },
        { x: 0, z: 250, height: 190, radius: 95 },
        { x: -200, z: 200, height: 175, radius: 90 },
        { x: -280, z: 0, height: 185, radius: 92 },
    ];

    mountains.forEach(m => {
        const group = new THREE.Group();

        // Main mountain cone (shortened to make room for snow cap)
        const mainHeight = m.height * 0.75;
        const coneGeom = new THREE.ConeGeometry(m.radius, mainHeight, 16);
        const cone = new THREE.Mesh(coneGeom, mountainMaterial);
        cone.position.y = mainHeight / 2;
        group.add(cone);

        // Snow cap overlaps into the mountain peak
        const snowHeight = m.height * 0.35;
        const snowRadius = m.radius * 0.25;
        const snowGeom = new THREE.ConeGeometry(snowRadius, snowHeight, 16);
        const snow = new THREE.Mesh(snowGeom, snowMaterial);
        snow.position.y = mainHeight - snowHeight * 0.25;
        group.add(snow);

        group.position.set(m.x, 0, m.z);
        scene.add(group);
        mountainObjects.push(group);
    });

    // Create clouds/mist
    createClouds();

    // Create trees behind mountains
    createTrees();
}

function createClouds() {
    const cloudMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.7,
        roughness: 1,
        metalness: 0,
    });

    const mistMaterial = new THREE.MeshStandardMaterial({
        color: 0xd0e0f0,
        transparent: true,
        opacity: 0.4,
        roughness: 1,
        metalness: 0,
    });

    // Create a fluffy cloud from multiple spheres
    function createCloud(x, y, z, scale) {
        const cloud = new THREE.Group();

        // Random number of puffs per cloud
        const numPuffs = 5 + Math.floor(Math.random() * 6);

        for (let i = 0; i < numPuffs; i++) {
            const size = (30 + Math.random() * 40) * scale;
            const puffGeom = new THREE.SphereGeometry(size, 8, 6);
            const puff = new THREE.Mesh(puffGeom, cloudMaterial);

            puff.position.set(
                (Math.random() - 0.5) * 100 * scale,
                (Math.random() - 0.5) * 30 * scale,
                (Math.random() - 0.5) * 60 * scale
            );
            puff.scale.y = 0.6; // Flatten slightly
            cloud.add(puff);
        }

        // Earth curvature: clouds further from center appear lower
        const distFromCenter = Math.sqrt(x * x + z * z);
        const curvatureDrop = distFromCenter * 0.15;
        const adjustedY = y * 2 - curvatureDrop;

        cloud.position.set(x, adjustedY, z);
        scene.add(cloud);
        cloudObjects.push(cloud);
    }

    // Create mist layer (low-lying fog around mountains)
    function createMistBank(x, y, z, width, depth) {
        const mistGeom = new THREE.PlaneGeometry(width, depth);
        const mist = new THREE.Mesh(mistGeom, mistMaterial);
        mist.rotation.x = -Math.PI / 2;
        mist.position.set(x, y, z);
        scene.add(mist);
        cloudObjects.push(mist);
    }

    // Clouds behind the mountains (further from center)
    const cloudPositions = [
        { x: -320, y: 120, z: -380, scale: 1.2 },
        { x: 0, y: 140, z: -420, scale: 1.5 },
        { x: 300, y: 110, z: -360, scale: 1.1 },
        { x: 420, y: 130, z: -150, scale: 1.3 },
        { x: 430, y: 100, z: 120, scale: 1.0 },
        { x: 320, y: 150, z: 340, scale: 1.4 },
        { x: 0, y: 160, z: 420, scale: 1.6 },
        { x: -300, y: 120, z: 360, scale: 1.2 },
        { x: -420, y: 140, z: 150, scale: 1.3 },
        { x: -400, y: 110, z: -120, scale: 1.1 },
        // Some additional clouds filling gaps
        { x: -160, y: 100, z: -400, scale: 1.0 },
        { x: 160, y: 95, z: -400, scale: 0.9 },
        { x: 400, y: 105, z: 0, scale: 1.1 },
        { x: -400, y: 100, z: 0, scale: 1.0 },
    ];

    cloudPositions.forEach(pos => {
        createCloud(pos.x, pos.y, pos.z, pos.scale);
    });

    // Add mist banks in valleys between mountains
    createMistBank(-100, 25, -200, 200, 150);
    createMistBank(100, 20, -180, 180, 120);
    createMistBank(180, 30, 100, 160, 140);
    createMistBank(-120, 25, 180, 190, 130);
    createMistBank(0, 35, 0, 300, 200); // Central mist
}

function createTrees() {
    // Dark green trunk and foliage materials
    const trunkMaterial = new THREE.MeshStandardMaterial({
        color: 0x3d2817,
        roughness: 0.95,
    });

    // Varied dark green colors for foliage
    const foliageColors = [0x1a4d1a, 0x1e5c1e, 0x164016, 0x2d5a2d, 0x0f3d0f];

    function createTree(x, z, scale = 1) {
        const tree = new THREE.Group();
        const treeType = Math.floor(Math.random() * 4); // 4 different tree types

        // Random variations
        const heightVar = 0.7 + Math.random() * 0.6;
        const widthVar = 0.6 + Math.random() * 0.8;
        const colorIndex = Math.floor(Math.random() * foliageColors.length);
        const foliageMat = new THREE.MeshStandardMaterial({
            color: foliageColors[colorIndex],
            roughness: 0.85,
        });

        const trunkHeight = 3 * scale * heightVar;
        const trunkRadius = 0.4 * scale * widthVar;

        // Trunk
        const trunkGeom = new THREE.CylinderGeometry(trunkRadius * 0.6, trunkRadius, trunkHeight, 6);
        const trunk = new THREE.Mesh(trunkGeom, trunkMaterial);
        trunk.position.y = trunkHeight / 2;
        tree.add(trunk);

        if (treeType === 0) {
            // Conifer - tall narrow pine
            const numLayers = 4 + Math.floor(Math.random() * 3);
            for (let i = 0; i < numLayers; i++) {
                const layerHeight = (5 - i * 0.5) * scale * heightVar;
                const layerRadius = (3 - i * 0.4) * scale * widthVar;
                const coneGeom = new THREE.ConeGeometry(layerRadius, layerHeight, 7);
                const cone = new THREE.Mesh(coneGeom, foliageMat);
                cone.position.y = trunkHeight + i * 1.8 * scale + layerHeight / 2;
                cone.rotation.y = Math.random() * Math.PI;
                tree.add(cone);
            }
        } else if (treeType === 1) {
            // Bushy deciduous - sphere foliage
            const numClusters = 3 + Math.floor(Math.random() * 3);
            for (let i = 0; i < numClusters; i++) {
                const clusterSize = (4 + Math.random() * 3) * scale * widthVar;
                const sphereGeom = new THREE.SphereGeometry(clusterSize, 8, 6);
                const sphere = new THREE.Mesh(sphereGeom, foliageMat);
                sphere.position.set(
                    (Math.random() - 0.5) * 3 * scale,
                    trunkHeight + 3 * scale + Math.random() * 4 * scale,
                    (Math.random() - 0.5) * 3 * scale
                );
                sphere.scale.y = 0.7 + Math.random() * 0.3;
                tree.add(sphere);
            }
        } else if (treeType === 2) {
            // Tall spruce - single elongated cone
            const coneHeight = 12 * scale * heightVar;
            const coneRadius = 3.5 * scale * widthVar;
            const coneGeom = new THREE.ConeGeometry(coneRadius, coneHeight, 8);
            const cone = new THREE.Mesh(coneGeom, foliageMat);
            cone.position.y = trunkHeight + coneHeight / 2;
            tree.add(cone);
        } else {
            // Mixed - cone base with sphere top
            const coneHeight = 6 * scale * heightVar;
            const coneRadius = 4 * scale * widthVar;
            const coneGeom = new THREE.ConeGeometry(coneRadius, coneHeight, 7);
            const cone = new THREE.Mesh(coneGeom, foliageMat);
            cone.position.y = trunkHeight + coneHeight / 2;
            tree.add(cone);

            const sphereSize = 3 * scale * widthVar;
            const sphereGeom = new THREE.SphereGeometry(sphereSize, 7, 5);
            const sphere = new THREE.Mesh(sphereGeom, foliageMat);
            sphere.position.y = trunkHeight + coneHeight + sphereSize * 0.5;
            tree.add(sphere);
        }

        // Random rotation for variety
        tree.rotation.y = Math.random() * Math.PI * 2;
        tree.position.set(x, 0, z);
        scene.add(tree);
        treeObjects.push(tree);
    }

    // Mountain positions to find gaps between them
    const mountains = [
        { x: -200, z: -200 },
        { x: 0, z: -250 },
        { x: 200, z: -200 },
        { x: 280, z: 0 },
        { x: 200, z: 200 },
        { x: 0, z: 250 },
        { x: -200, z: 200 },
        { x: -280, z: 0 },
    ];

    // Calculate angles of mountains from center
    const mountainAngles = mountains.map(m => Math.atan2(m.z, m.x));

    // Find gap centers (midpoint angles between adjacent mountains)
    const gapAngles = [];
    for (let i = 0; i < mountainAngles.length; i++) {
        const a1 = mountainAngles[i];
        const a2 = mountainAngles[(i + 1) % mountainAngles.length];

        // Handle angle wrapping
        let midAngle = (a1 + a2) / 2;
        if (Math.abs(a2 - a1) > Math.PI) {
            midAngle += Math.PI;
        }
        gapAngles.push(midAngle);
    }

    // Place dense trees in each gap
    const treesPerGap = 80;
    const minDistance = 280;
    const maxDistance = 420;

    gapAngles.forEach(gapAngle => {
        for (let i = 0; i < treesPerGap; i++) {
            // Spread trees within the gap (narrow angle range)
            const angleSpread = 0.35; // How wide the gap filling is
            const angle = gapAngle + (Math.random() - 0.5) * angleSpread;
            const dist = minDistance + Math.random() * (maxDistance - minDistance);
            const x = Math.cos(angle) * dist;
            const z = Math.sin(angle) * dist;
            const scale = 0.5 + Math.random() * 0.8;
            createTree(x, z, scale);
        }
    });
}

let cityWater = null;
let cityWaterTime = 0;
let cityCars = [];
let cityCarModelLoaded = false;
let cityCarBaseModel = null;

function createCityCars() {
    if (cityCars.length > 0 || !cityCarModelLoaded) return;

    const pathLength = getCityPathLength();
    const carColors = [
        0x333333, // Dark gray
        0x666666, // Medium gray
        0x999999, // Light gray
        0x111111, // Near black
        0x000000, // Black
        0xeeeeee, // White
        0xffffff, // Pure white
    ];

    // Spawn driving cars at intervals along the path
    const numCars = 30;
    const spacing = pathLength / numCars;

    for (let i = 0; i < numCars; i++) {
        const distance = i * spacing + Math.random() * spacing * 0.5;
        const laneOffset = 3 + Math.random() * 1.5; // Drive lanes (offset from runner path)
        const direction = Math.random() > 0.5 ? 1 : -1; // Random direction
        const speed = (8 + Math.random() * 6) * direction; // 8-14 m/s, random direction

        // Clone the base model
        const carContainer = new THREE.Group();
        const carModel = cityCarBaseModel.clone();

        // Apply random color
        const color = carColors[Math.floor(Math.random() * carColors.length)];
        carModel.traverse((child) => {
            if (child.isMesh) {
                child.material = child.material.clone();
                child.material.color.setHex(color);
            }
        });

        // Fix rotation (same as Celica easter egg)
        carModel.rotation.x = -Math.PI / 2;
        carModel.scale.setScalar(1.0);

        carContainer.add(carModel);

        // Store driving data
        carContainer.userData = {
            distance: distance,
            laneOffset: laneOffset,
            speed: speed,
            pathLength: pathLength
        };

        // Initial position
        const pos = getCityStreetPosition(distance, laneOffset);
        carContainer.position.set(pos.x, 0, pos.z);

        // Face the direction of travel
        const aheadPos = getCityStreetPosition(distance + 5 * direction, laneOffset);
        carContainer.lookAt(aheadPos.x, 0, aheadPos.z);

        carContainer.visible = (currentView === 'city');
        scene.add(carContainer);
        cityCars.push(carContainer);
        cityObjects.push(carContainer);
    }

    console.log(`Created ${numCars} driving city cars`);
}

function updateCityCars(delta) {
    if (currentView !== 'city') return;

    for (const car of cityCars) {
        const data = car.userData;
        if (!data.speed) continue;

        // Update distance
        data.distance += data.speed * delta;

        // Wrap around path
        if (data.distance < 0) data.distance += data.pathLength;
        if (data.distance > data.pathLength) data.distance -= data.pathLength;

        // Update position
        const pos = getCityStreetPosition(data.distance, data.laneOffset);
        car.position.set(pos.x, 0, pos.z);

        // Update rotation to face direction of travel
        const direction = data.speed > 0 ? 1 : -1;
        const aheadPos = getCityStreetPosition(data.distance + 2 * direction, data.laneOffset);
        car.lookAt(aheadPos.x, 0, aheadPos.z);
    }
}

function loadCityCarModel() {
    const loader = new FBXLoader();
    loader.load(
        'models/Celica_GTO.fbx',
        (fbx) => {
            cityCarBaseModel = fbx;
            cityCarModelLoaded = true;
            console.log('City car model loaded');

            // If city is already loaded, create cars now
            if (cityLoaded && currentView === 'city') {
                createCityCars();
            }
        },
        undefined,
        (error) => {
            console.log('Could not load city car model:', error);
        }
    );
}

function createCity() {
    if (cityLoaded) return;
    cityLoaded = true;

    // Create water as a ring around the outside of the city
    const innerRadius = 600;  // Inside edge of water (around city)
    const outerRadius = 1500; // Outside edge of water
    const waterShape = new THREE.Shape();
    waterShape.absarc(0, 0, outerRadius, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, innerRadius, 0, Math.PI * 2, true);
    waterShape.holes.push(hole);

    const waterGeometry = new THREE.ShapeGeometry(waterShape, 64);
    waterGeometry.rotateX(-Math.PI / 2);

    const waterMaterial = new THREE.MeshStandardMaterial({
        color: 0x006994,
        roughness: 0.3,
        metalness: 0.6,
        transparent: true,
        opacity: 0.85,
    });

    cityWater = new THREE.Mesh(waterGeometry, waterMaterial);
    cityWater.position.y = -5;
    cityWater.visible = (currentView === 'city');
    scene.add(cityWater);
    cityObjects.push(cityWater);

    // Store original vertex positions for wave animation
    const positions = waterGeometry.attributes.position;
    cityWater.userData.originalPositions = new Float32Array(positions.array);

    // Black ground plane under the city to fill gaps
    const groundGeometry = new THREE.CircleGeometry(800, 64);
    const groundMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const cityGround = new THREE.Mesh(groundGeometry, groundMaterial);
    cityGround.rotation.x = -Math.PI / 2;
    cityGround.position.y = -4;
    cityGround.visible = (currentView === 'city');
    scene.add(cityGround);
    cityObjects.push(cityGround);

    const loader = new FBXLoader();
    loader.load(
        'models/city/City_NewYork.fbx',
        (fbx) => {
            // Scale and position the city
            fbx.scale.setScalar(0.006);
            fbx.position.set(0, 0, 0);

            // Disable shadows for city buildings
            fbx.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = false;
                    child.receiveShadow = false;
                }
            });

            fbx.visible = (currentView === 'city');
            scene.add(fbx);
            cityObjects.push(fbx);

            console.log('City loaded!');

            // Create city cars if model is ready
            if (cityCarModelLoaded) {
                createCityCars();
            }
        },
        (progress) => {
            console.log('Loading city...', (progress.loaded / progress.total * 100).toFixed(0) + '%');
        },
        (error) => {
            console.error('Error loading city:', error);
        }
    );
}

function createMountainRoads() {
    if (mountainRoadsLoaded) return;
    mountainRoadsLoaded = true;

    const loader = new GLTFLoader();
    loader.load(
        'models/burnout_revenge_white_mountain.glb',
        (gltf) => {
            const model = gltf.scene;
            mountainRoadsModel = model;

            // Scale and position - adjust as needed
            model.scale.setScalar(60.0);
            model.position.set(0, 0, 0);

            // Enable shadows
            model.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            model.visible = (currentView === 'mountain_roads');
            scene.add(model);
            mountainRoadsObjects.push(model);

            console.log('Mountain Roads loaded!');

            // Calculate ground heights by raycasting down from each waypoint
            calculateMountainRoadsGroundHeights();
        },
        (progress) => {
            console.log('Loading mountain roads...', (progress.loaded / progress.total * 100).toFixed(0) + '%');
        },
        (error) => {
            console.error('Error loading mountain roads:', error);
        }
    );
}

function calculateMountainRoadsGroundHeights() {
    if (!mountainRoadsModel) return;

    // Make sure matrices are up to date
    mountainRoadsModel.updateMatrixWorld(true);

    const waypoints = getMountainRoadsWaypoints();
    const heights = [];
    const raycaster = new THREE.Raycaster();
    const downDirection = new THREE.Vector3(0, -1, 0);

    // We need to raycast against all meshes in the model
    const meshes = [];
    mountainRoadsModel.traverse((child) => {
        if (child.isMesh) {
            meshes.push(child);
        }
    });

    console.log(`Calculating ground heights for ${waypoints.length} waypoints against ${meshes.length} meshes...`);

    // Maximum height change per waypoint that's considered a gradual road slope
    const maxGradualChange = 3;
    let lastValidHeight = null;

    for (let i = 0; i < waypoints.length; i++) {
        const wp = waypoints[i];
        // Start from well above the waypoint and cast down
        const origin = new THREE.Vector3(wp.x, 500, wp.z);
        raycaster.set(origin, downDirection);
        raycaster.far = 1000;

        const intersects = raycaster.intersectObjects(meshes, false);

        if (intersects.length > 0) {
            // Multiple surfaces might be hit (bridges, roofs over roads)
            // Pick the one that represents a gradual change from the previous height
            let bestHeight = null;

            if (lastValidHeight === null) {
                // First point - use the traced waypoint Y as reference
                const referenceY = wp.y - 1.7; // Approximate ground from camera height
                let closestDiff = Infinity;
                for (const hit of intersects) {
                    const diff = Math.abs(hit.point.y - referenceY);
                    if (diff < closestDiff) {
                        closestDiff = diff;
                        bestHeight = hit.point.y;
                    }
                }
            } else {
                // Find the intersection closest to the previous height (gradual change)
                let closestDiff = Infinity;
                for (const hit of intersects) {
                    const diff = Math.abs(hit.point.y - lastValidHeight);
                    if (diff < closestDiff) {
                        closestDiff = diff;
                        bestHeight = hit.point.y;
                    }
                }

                // If the best hit is still a big jump, it might be going under a bridge
                // In that case, look for a lower surface that's more consistent
                if (Math.abs(bestHeight - lastValidHeight) > maxGradualChange) {
                    // Sort intersections by Y (lowest first) and find one within tolerance
                    const sortedByY = [...intersects].sort((a, b) => a.point.y - b.point.y);
                    for (const hit of sortedByY) {
                        if (Math.abs(hit.point.y - lastValidHeight) <= maxGradualChange) {
                            bestHeight = hit.point.y;
                            break;
                        }
                    }
                }
            }

            heights.push(bestHeight);
            lastValidHeight = bestHeight;
        } else {
            // No ground found - use original Y minus a constant offset as fallback
            const fallbackHeight = wp.y - 1.7;
            heights.push(fallbackHeight);
            lastValidHeight = fallbackHeight;
        }
    }

    // Apply smoothing pass to reduce remaining jitter
    const finalHeights = [];
    const smoothingWindow = 3;
    for (let i = 0; i < heights.length; i++) {
        let sum = 0;
        let count = 0;
        for (let j = -smoothingWindow; j <= smoothingWindow; j++) {
            const idx = (i + j + heights.length) % heights.length;
            sum += heights[idx];
            count++;
        }
        finalHeights.push(sum / count);
    }

    console.log(`Ground heights calculated: ${heights.length} total`);

    setMountainRoadsGroundHeights(finalHeights);
}

function updateCityWater(time) {
    if (!cityWater || currentView !== 'city') return;

    const geometry = cityWater.geometry;
    const positions = geometry.attributes.position;
    const original = cityWater.userData.originalPositions;

    for (let i = 0; i < positions.count; i++) {
        const x = original[i * 3];
        const y = original[i * 3 + 1];

        // Create wave effect
        const waveX = Math.sin(x * 0.05 + time * 0.001) * 1.5;
        const waveY = Math.cos(y * 0.05 + time * 0.0012) * 1.5;
        const wave = waveX + waveY;

        positions.array[i * 3 + 2] = wave;
    }

    positions.needsUpdate = true;
    geometry.computeVertexNormals();
}

function setView(viewName) {
    currentView = viewName;

    if (viewName === 'mountain') {
        // Mountain view - cooler colors, mountains visible
        scene.background = new THREE.Color(0x6ba3d6);
        scene.fog = new THREE.Fog(0x6ba3d6, 150, 500);
        hemiLight.color.setHex(0x6ba3d6);

        // Reset sun to angled position
        sunLight.position.set(50, 100, 30);

        // Use track path
        setPathMode('track');

        // Create mountains if not already created
        if (mountainObjects.length === 0) {
            createMountains();
        }
        // Show mountains, clouds, trees, and track; hide city and mountain roads
        mountainObjects.forEach(obj => obj.visible = true);
        cloudObjects.forEach(obj => obj.visible = true);
        treeObjects.forEach(obj => obj.visible = true);
        cityObjects.forEach(obj => obj.visible = false);
        mountainRoadsObjects.forEach(obj => obj.visible = false);
        trackObjects.forEach(obj => obj.visible = true);

    } else if (viewName === 'city') {
        // City view - urban atmosphere, run on streets (no oval track)
        scene.background = new THREE.Color(0x87CEEB);
        scene.fog = null; // No fog in city mode for better visibility
        hemiLight.color.setHex(0x87CEEB);

        // Sun directly overhead for even wall shading
        sunLight.position.set(0, 200, 0);

        // Use city street path
        setPathMode('city');

        // Load city if not already loaded
        if (!cityLoaded) {
            createCity();
        }
        // Show city; hide everything else
        mountainObjects.forEach(obj => obj.visible = false);
        cloudObjects.forEach(obj => obj.visible = false);
        treeObjects.forEach(obj => obj.visible = false);
        cityObjects.forEach(obj => obj.visible = true);
        mountainRoadsObjects.forEach(obj => obj.visible = false);
        trackObjects.forEach(obj => obj.visible = false);

    } else if (viewName === 'mountain_roads') {
        // Mountain Roads view - snowy mountain roads with elevation changes
        scene.background = new THREE.Color(0xc4d4e0);
        scene.fog = new THREE.Fog(0xc4d4e0, 200, 800);
        hemiLight.color.setHex(0xc4d4e0);

        // Reset sun to angled position
        sunLight.position.set(50, 100, 30);

        // Use mountain roads path
        setPathMode('mountain_roads');

        // Load mountain roads if not already loaded
        if (!mountainRoadsLoaded) {
            createMountainRoads();
        }
        // Show mountain roads; hide everything else
        mountainObjects.forEach(obj => obj.visible = false);
        cloudObjects.forEach(obj => obj.visible = false);
        treeObjects.forEach(obj => obj.visible = false);
        cityObjects.forEach(obj => obj.visible = false);
        mountainRoadsObjects.forEach(obj => obj.visible = true);
        trackObjects.forEach(obj => obj.visible = false);

    } else {
        // Default view - warm sunny day
        scene.background = new THREE.Color(0x87CEEB);
        scene.fog = new THREE.Fog(0x87CEEB, 100, 400);
        hemiLight.color.setHex(0x87CEEB);

        // Reset sun to angled position
        sunLight.position.set(50, 100, 30);

        // Use track path
        setPathMode('track');

        // Hide everything except track
        mountainObjects.forEach(obj => obj.visible = false);
        cloudObjects.forEach(obj => obj.visible = false);
        treeObjects.forEach(obj => obj.visible = false);
        cityObjects.forEach(obj => obj.visible = false);
        mountainRoadsObjects.forEach(obj => obj.visible = false);
        trackObjects.forEach(obj => obj.visible = true);
    }

    // Update UI selection
    document.querySelectorAll('.view-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.view === viewName);
    });
}

// ============================================
// SETTINGS UI
// ============================================

document.getElementById('settingsButton').addEventListener('click', () => {
    document.getElementById('settingsModal').style.display = 'flex';

    // Disable map options during a race
    document.querySelectorAll('.view-option').forEach(opt => {
        if (raceStarted) {
            opt.style.opacity = '0.4';
            opt.style.pointerEvents = 'none';
            opt.title = 'Cannot change map during race';
        } else {
            opt.style.opacity = '1';
            opt.style.pointerEvents = 'auto';
            opt.title = '';
        }
    });

    // Show restart race button during a race (for host in multiplayer, or always in single player)
    const restartSection = document.getElementById('restartRaceSection');
    const networkManager = getNetworkManager();
    if (restartSection) {
        const isMultiplayer = networkManager && networkManager.connections.size > 0;
        const canRestart = raceStarted && (!isMultiplayer || networkManager.isHost);
        restartSection.style.display = canRestart ? 'block' : 'none';
    }
});

document.getElementById('settingsClose').addEventListener('click', () => {
    document.getElementById('settingsModal').style.display = 'none';
});

document.getElementById('quitGame').addEventListener('click', () => {
    // Hide settings modal
    document.getElementById('settingsModal').style.display = 'none';

    // Reset game state
    raceStarted = false;
    player.raceActive = false;
    raceTime = 0;
    lastLapBellPlayed = false;

    // Hide game UI
    document.getElementById('startButton').style.display = 'none';
    document.getElementById('paceSliderContainer').style.display = 'none';
    document.getElementById('raceInfo').style.display = 'none';
    document.getElementById('info').style.display = 'none';

    // Show main menu
    document.getElementById('mainMenuModal').style.display = 'flex';

    // Remove player ghost if exists
    if (playerGhost) {
        scene.remove(playerGhost);
        playerGhost = null;
        playerGhostMixer = null;
        playerGhostAction = null;
    }

    // Reset character selection
    window.playerCharacter = null;
    window.playerCharacterModel = null;

    console.log('Quit to main menu');
});

document.querySelectorAll('.view-option').forEach(option => {
    option.addEventListener('click', () => {
        // Don't allow map changes during a race
        if (raceStarted) {
            console.log('Cannot change map during a race');
            return;
        }
        setView(option.dataset.view);
    });
});

// Restart race button (host only)
document.getElementById('restartRaceButton').addEventListener('click', () => {
    const networkManager = getNetworkManager();
    if (networkManager && networkManager.isHost) {
        networkManager.restartRace();
    } else {
        // Single player restart
        restartRace();
    }
    document.getElementById('settingsModal').style.display = 'none';
});

// Restart race function
function restartRace() {
    console.log('Restarting race...');

    // Reset race time
    raceTime = 0;
    lastLapBellPlayed = false;

    // Reset player position
    player.distance = 0;
    player.finished = false;
    player.raceActive = true;
    const startPos = getPosition(0, player.lanePosition);
    if (playerGhost) {
        playerGhost.position.set(startPos.x, startPos.y || 0, startPos.z);
    }

    // Reset AI runners
    aiRunners.forEach((runner, i) => {
        runner.distance = 0;
        runner.finished = false;
        const runnerStartPos = getPosition(0, runner.lane);
        if (runner.model) {
            runner.model.position.set(runnerStartPos.x, runnerStartPos.y || 0, runnerStartPos.z);
        }
    });

    // Reset remote player distances (visual only, they'll sync their own positions)
    remotePlayerMeshes.forEach((meshData, peerId) => {
        meshData.distance = 0;
        if (meshData.mesh) {
            const remoteStartPos = getPosition(0, meshData.lanePosition || 1);
            meshData.mesh.position.set(remoteStartPos.x, remoteStartPos.y || 0, remoteStartPos.z);
        }
    });

    // Reset energy system
    if (energySystem) {
        energySystem.reset();
    }

    // Reset relay manager
    if (relayManager) {
        relayManager.reset();
        relayManager.startRace(0);
    }

    // Reset input manager
    if (inputManager) {
        inputManager.resetSpeed(0);
    }

    // Stop any celebration
    stopWinnerCelebration();

    // Reset replay data
    raceReplayData = [];
    lastReplayRecordTime = 0;

    // Reset ghosts
    if (ghostManager) {
        ghostManager.resetAll();
    }

    console.log('Race restarted!');
}

// Expose restart function for network callback
window.restartRace = restartRace;

// ============================================
// GAME STATE
// ============================================

const aiRunners = [];
let raceStarted = false;
let raceTime = 0;
// Default to 15:00 pace (900 seconds goal, winner at 890 seconds)
// timeScaleFactor = 890 / 791.3 ≈ 1.125
let timeScaleFactor = 890 / 791.3;
let userGoalTime = 900;
let lastLapBellPlayed = false;

// Race replay recording
let raceReplayData = [];
const REPLAY_RECORD_INTERVAL = 1 / 30; // 30 FPS recording
let lastReplayRecordTime = 0;

// Ghost vs AI mode (true = race against past race ghosts, false = race against AI)
let useGhostsInsteadOfAI = false;

// Race mode state
let currentRaceMode = null; // Set from window.raceMode after selection
let inputManager = null;
let energySystem = null;
let relayManager = null;
let ghostManager = null;
let scoreboard = null;
let raceDistance = 1600; // Will be updated based on mode

// Initialize scoreboard
scoreboard = getScoreboard();

// Multiplayer state
let isMultiplayer = false;
const remotePlayerMeshes = new Map(); // peerId -> { mesh, mixer, action }
let networkUpdateInterval = null;

// Get network manager (singleton)
const networkManager = getNetworkManager();

// Setup network callbacks for remote player updates
function setupNetworkSync() {
    networkManager.on('onPlayerUpdate', (player) => {
        updateRemotePlayerPosition(player);
    });

    networkManager.on('onPlayerJoin', (player) => {
        console.log('Remote player joined race:', player.name);
        createRemotePlayerMesh(player);
    });

    networkManager.on('onPlayerLeave', (player) => {
        console.log('Remote player left race:', player.name);
        removeRemotePlayerMesh(player.peerId);
    });

    networkManager.on('onPlayerListUpdate', (players) => {
        // Create or update meshes for all remote players
        players.forEach(p => {
            if (p.peerId === networkManager.localPlayer?.peerId) return;

            const existingMesh = remotePlayerMeshes.get(p.peerId);

            if (!existingMesh) {
                // New player - create mesh
                createRemotePlayerMesh(p);
            } else if (p.characterModel && existingMesh.characterModel !== p.characterModel) {
                // Character changed - recreate mesh
                console.log('Updating remote player character:', p.name, p.characterModel);
                removeRemotePlayerMesh(p.peerId);
                createRemotePlayerMesh(p);
            }
        });
    });

    networkManager.on('onPlayerReady', (player) => {
        // When a player selects their character and becomes ready,
        // recreate their mesh with the correct character model
        if (player.peerId !== networkManager.localPlayer?.peerId) {
            console.log('Remote player ready with character:', player.name, player.characterModel);

            // Remove old mesh (might be a fallback capsule)
            removeRemotePlayerMesh(player.peerId);

            // Create new mesh with correct character
            createRemotePlayerMesh(player);
        }
    });
}

// Character model paths (must match index.html CHARACTER_MODELS)
const REMOTE_CHARACTER_MODELS = {
    trump: 'public/characters/trump/source/Running.fbx',
    musk: 'public/characters/musk.fbx',
    stalin: 'public/characters/stalin.fbx',
    skeleton: 'public/characters/skeleton.fbx',
    snowman: 'public/characters/snowman.fbx',
    demon: 'public/characters/demon.fbx'
};

// Rotation offsets for models that don't face +Z by default (in radians)
// Positive = rotate clockwise, Negative = rotate counter-clockwise
const MODEL_ROTATION_OFFSETS = {
    skeleton: -Math.PI / 2,  // Skeleton faces +X, needs -90 degree rotation
    // Add other models here if they face the wrong direction
};

// Scale overrides for models with different internal sizes
const MODEL_SCALE_OVERRIDES = {
    stalin: 0.018,   // Stalin model is smaller, needs larger scale
    demon: 0.008,    // Demon model is larger
    // Default scale is 0.01
};

// Create mesh for remote players using their selected character model
function createRemotePlayerMesh(remotePlayer) {
    // Check if using default character (colored capsule)
    if (remotePlayer.isDefaultCharacter || remotePlayer.characterModel === 'default') {
        console.log('Creating default runner mesh for:', remotePlayer.name);
        createFallbackMesh(remotePlayer);
        return;
    }

    const loader = new FBXLoader();

    // Get the character model path
    const characterKey = remotePlayer.characterModel || 'trump';
    const modelPath = REMOTE_CHARACTER_MODELS[characterKey];

    if (!modelPath) {
        console.log('No model path for character:', characterKey, '- using fallback');
        createFallbackMesh(remotePlayer);
        return;
    }

    console.log('Loading remote player model:', modelPath, 'for', remotePlayer.name);

    // Create placeholder while loading
    remotePlayerMeshes.set(remotePlayer.peerId, {
        mesh: null,
        mixer: null,
        action: null,
        distance: remotePlayer.distance || 0,
        lanePosition: remotePlayer.lane || 1,
        characterModel: remotePlayer.characterModel,
        loading: true
    });

    loader.load(
        modelPath,
        (fbx) => {
            // Scale the model (use character-specific scale or default)
            const characterKey = remotePlayer.characterModel || '';
            const scale = MODEL_SCALE_OVERRIDES[characterKey] || 0.01;
            fbx.scale.setScalar(scale);

            // Setup animation
            const mixer = new THREE.AnimationMixer(fbx);
            let action = null;
            if (fbx.animations.length > 0) {
                action = mixer.clipAction(fbx.animations[0]);
                action.play();
            }

            // Apply shadow settings
            fbx.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            // Position on track
            const meshData = remotePlayerMeshes.get(remotePlayer.peerId);
            if (meshData) {
                const pos = getPosition(meshData.distance, meshData.lanePosition);
                fbx.position.set(pos.x, pos.y || 0, pos.z);

                // Face forward
                const aheadPos = getPosition(meshData.distance + 2, meshData.lanePosition);
                fbx.lookAt(aheadPos.x, aheadPos.y || 0, aheadPos.z);

                // Apply model-specific rotation offset
                const rotationOffset = MODEL_ROTATION_OFFSETS[remotePlayer.characterModel] || 0;
                if (rotationOffset !== 0) {
                    fbx.rotation.y += rotationOffset;
                }
            }

            scene.add(fbx);

            // Update the mesh data
            remotePlayerMeshes.set(remotePlayer.peerId, {
                mesh: fbx,
                mixer: mixer,
                action: action,
                distance: meshData?.distance || 0,
                lanePosition: meshData?.lanePosition || 1,
                characterModel: remotePlayer.characterModel,
                loading: false
            });

            console.log('Remote player model loaded:', remotePlayer.name);
        },
        (progress) => {
            // Loading progress
        },
        (error) => {
            console.error('Error loading remote player model:', error);
            // Fall back to simple capsule on error
            createFallbackMesh(remotePlayer);
        }
    );
}

// Fallback capsule mesh if model fails to load
function createFallbackMesh(remotePlayer) {
    const geometry = new THREE.CapsuleGeometry(0.3, 1.0, 4, 8);
    const material = new THREE.MeshStandardMaterial({
        color: RUNNER_COLORS[remotePlayer.lane - 1] || 0x00ff00,
        roughness: 0.7,
        metalness: 0.1
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const meshData = remotePlayerMeshes.get(remotePlayer.peerId);
    const pos = getPosition(meshData?.distance || 0, meshData?.lanePosition || 1);
    mesh.position.set(pos.x, (pos.y || 0) + 0.8, pos.z);

    scene.add(mesh);

    remotePlayerMeshes.set(remotePlayer.peerId, {
        mesh,
        mixer: null,
        action: null,
        distance: meshData?.distance || 0,
        lanePosition: meshData?.lanePosition || 1,
        characterModel: remotePlayer.characterModel || 'default',
        loading: false
    });
}

// Update remote player position from network data
function updateRemotePlayerPosition(remotePlayer) {
    const meshData = remotePlayerMeshes.get(remotePlayer.peerId);
    if (!meshData) return;

    // Store the updated position data
    meshData.distance = remotePlayer.distance;
    meshData.lanePosition = remotePlayer.lanePosition;

    // If still loading, just store the data for when model loads
    if (meshData.loading || !meshData.mesh) return;

    // Update position on track
    const pos = getPosition(meshData.distance, meshData.lanePosition);
    const groundY = pos.y || 0;
    meshData.mesh.position.set(pos.x, groundY, pos.z);

    // Face forward
    const aheadPos = getPosition(meshData.distance + 2, meshData.lanePosition);
    meshData.mesh.lookAt(aheadPos.x, aheadPos.y || 0, aheadPos.z);

    // Apply model-specific rotation offset (for models that don't face +Z)
    const rotationOffset = MODEL_ROTATION_OFFSETS[meshData.characterModel] || 0;
    if (rotationOffset !== 0) {
        meshData.mesh.rotation.y += rotationOffset;
    }
}

// Update remote player animations (call from animation loop)
function updateRemotePlayerAnimations(delta) {
    remotePlayerMeshes.forEach((meshData) => {
        if (meshData.mixer && !meshData.loading) {
            meshData.mixer.update(delta);
        }
    });
}

// Remove remote player mesh
function removeRemotePlayerMesh(peerId) {
    const meshData = remotePlayerMeshes.get(peerId);
    if (meshData && meshData.mesh) {
        scene.remove(meshData.mesh);

        // Dispose of all nested geometries and materials (for FBX models)
        meshData.mesh.traverse((child) => {
            if (child.isMesh) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            }
        });

        // Stop animations
        if (meshData.mixer) {
            meshData.mixer.stopAllAction();
        }

        remotePlayerMeshes.delete(peerId);
    }
}

// Send local player position update to network
function sendNetworkUpdate() {
    if (!networkManager.isConnected() || !raceStarted) return;

    networkManager.sendPlayerUpdate(
        player.distance,
        player.lanePosition,
        player.finished,
        player.finishTime
    );
}

// Get remote runners as collision objects (for lane movement collision detection)
function getRemoteRunnersForCollision() {
    const remoteRunners = [];
    remotePlayerMeshes.forEach((meshData, peerId) => {
        if (!meshData.loading && meshData.mesh) {
            remoteRunners.push({
                distance: meshData.distance,
                lanePosition: meshData.lanePosition
            });
        }
    });
    return remoteRunners;
}

// Player instance
const player = new Player(camera);

// Easter egg
const celica = new CelicaEasterEgg(scene);
celica.load();

// Load city car model for ambient traffic
loadCityCarModel();

// Shuffle race data for random lane assignment
const shuffledRaceData = shuffleArray(RACE_DATA);

// ============================================
// LOAD RUNNERS
// ============================================

// Load runners - use selected character for first runner if available
function loadRunners() {
    const loader = new FBXLoader();
    const defaultModel = 'models/Running.fbx';

    // Get player's selected character model path (set by character selection screen)
    const playerCharacterPath = window.playerCharacterModel?.path || null;

    // Load default model for AI runners
    loader.load(
        defaultModel,
        (fbx) => {
            for (let i = 0; i < 7; i++) {
                const lane = i + 2;
                const aiModel = (i === 0) ? fbx : SkeletonUtils.clone(fbx);

                const aiMixer = new THREE.AnimationMixer(aiModel);
                let aiAction = null;
                if (fbx.animations.length > 0) {
                    aiAction = aiMixer.clipAction(fbx.animations[0]);
                    aiAction.play();
                    aiAction.paused = true;
                }

                const runner = new Runner(
                    aiModel,
                    aiMixer,
                    aiAction,
                    lane,
                    shuffledRaceData[i],
                    i
                );

                const startPos = getPosition(0, lane);
                aiModel.position.set(startPos.x, 0, startPos.z);
                aiModel.rotation.y = startPos.rotation;

                scene.add(aiModel);
                aiRunners.push(runner);
            }

            document.getElementById('loading').style.display = 'none';
            console.log('AI Runners created:', aiRunners.length);

            aiRunners.forEach(r => {
                console.log(`Lane ${r.lane}: ${r.raceData.name}`);
            });

            // If player selected a custom character, load it as an additional "ghost" runner
            if (playerCharacterPath) {
                loadPlayerCharacterGhost(playerCharacterPath);
            }
        },
        (progress) => {
            const percent = (progress.loaded / progress.total * 100).toFixed(0);
            document.getElementById('loading').textContent = `Loading runners... ${percent}%`;
        },
        (error) => {
            console.error('Error loading character:', error);
            document.getElementById('loading').textContent = 'Error loading. Run: python3 -m http.server 8000';
        }
    );
}

// Load player's selected character as a "ghost" that follows the player
let playerGhost = null;
let playerGhostMixer = null;
let playerGhostAction = null;

function loadPlayerCharacterGhost(modelPath) {
    const loader = new FBXLoader();
    console.log('Loading player character:', modelPath, 'character:', window.playerCharacter);

    loader.load(
        modelPath,
        (fbx) => {
            playerGhost = fbx;

            // Use character-specific scale or default
            const characterKey = window.playerCharacter || '';
            const scale = MODEL_SCALE_OVERRIDES[characterKey] || 0.01;
            playerGhost.scale.setScalar(scale);
            console.log('Using scale:', scale, 'for character:', characterKey);

            // Fix materials that might be invisible due to missing textures
            fbx.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;

                    // Ensure materials are visible even without textures
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

            // Debug: log the model's bounding box to see actual size
            const box = new THREE.Box3().setFromObject(playerGhost);
            const size = box.getSize(new THREE.Vector3());
            console.log('Player model size after scaling:', size.x.toFixed(2), size.y.toFixed(2), size.z.toFixed(2));

            playerGhostMixer = new THREE.AnimationMixer(playerGhost);
            if (fbx.animations.length > 0) {
                playerGhostAction = playerGhostMixer.clipAction(fbx.animations[0]);
                playerGhostAction.play();
            }

            scene.add(playerGhost);
            console.log('Player character ghost loaded:', window.playerCharacter);
        },
        undefined,
        (error) => {
            console.error('Error loading player character:', error);
        }
    );
}

// Expose to window so it can be called from HTML
window.loadPlayerCharacter = function() {
    if (!playerGhost && window.playerCharacterModel?.path) {
        loadPlayerCharacterGhost(window.playerCharacterModel.path);
    }
};

// Start race after synchronized countdown (called from network sync)
// This bypasses the local countdown since it was already handled via network
window.startRaceAfterCountdown = function() {
    startRace();
};

// Export setView so it can be called from network sync
window.setView = function(viewName) {
    setView(viewName);
};

// Reset game state for next race or returning to menu
window.resetGameState = function() {
    raceStarted = false;
    player.raceActive = false;
    player.finished = false;
    raceTime = 0;
    lastLapBellPlayed = false;

    // Stop any ongoing celebration
    stopWinnerCelebration();

    // Disable focus warning
    if (window.setRaceActiveForFocus) {
        window.setRaceActiveForFocus(false);
    }

    // Reset ghosts
    if (ghostManager) {
        ghostManager.clearAll();
    }

    // Reset replay data
    raceReplayData = [];
    lastReplayRecordTime = 0;

    // Reset energy system
    energySystem = null;

    // Reset relay manager
    relayManager = null;

    // Hide race UI elements
    const energyContainer = document.getElementById('energyBarContainer');
    if (energyContainer) energyContainer.style.display = 'none';

    const mphDisplay = document.getElementById('mphDisplay');
    if (mphDisplay) mphDisplay.style.display = 'none';

    const legCounter = document.getElementById('legCounter');
    if (legCounter) legCounter.style.display = 'none';

    const lapCounter = document.getElementById('lapCounter');
    if (lapCounter) lapCounter.style.display = 'none';

    console.log('Game state reset');
};

// Call loadRunners (will be called after UI flow completes)
loadRunners();

// ============================================
// UI EVENT HANDLERS
// ============================================

// Pace slider
document.getElementById('paceSlider').addEventListener('input', (e) => {
    player.paceMinPerMile = parseFloat(e.target.value);
    document.getElementById('paceDisplay').textContent = formatPace(player.paceMinPerMile);
});

// Start race function
function startRace() {
    console.log('=== startRace() called ===');
    console.log('  window.raceMode:', window.raceMode);
    console.log('  window.isMultiplayer:', window.isMultiplayer);
    console.log('  networkManager.isConnected():', networkManager.isConnected());

    if (raceStarted) {
        console.log('  Race already started, returning');
        return;
    }

    // Stop any ongoing winner celebration
    stopWinnerCelebration();

    // Load player character if not loaded yet
    if (!playerGhost && window.playerCharacterModel?.path) {
        loadPlayerCharacterGhost(window.playerCharacterModel.path);
    }

    // Reset Celica Easter egg
    celica.reset();

    // Get race mode from selection (default to 1600m if not set)
    currentRaceMode = window.raceMode || RACE_MODE.MILE_1600;
    const modeConfig = RACE_MODES[currentRaceMode];

    // Calculate race distance based on mode
    raceDistance = getRaceDistance(currentRaceMode, 1); // Player in lane 1

    // Initialize input manager
    inputManager = new InputManager(currentRaceMode);

    // Initialize energy system based on mode
    if (modeConfig && modeConfig.energyType) {
        energySystem = createEnergySystem(modeConfig.energyType);
    } else {
        energySystem = null;
    }

    // Initialize ghost manager
    ghostManager = new GhostManager(scene);

    // For 400m and 1600m SOLO races, use past race ghosts instead of AI runners
    // Player always in lane 1, ghosts in lanes 2-8 (most recent race in lane 2)
    // In multiplayer, use real players instead
    const isSoloRace = !window.isMultiplayer;
    useGhostsInsteadOfAI = isSoloRace && (currentRaceMode === RACE_MODE.SPRINT_400 || currentRaceMode === RACE_MODE.MILE_1600);

    if (useGhostsInsteadOfAI) {
        // Load recent races as ghosts
        const recentRaces = scoreboard.getRecentRaces(currentRaceMode, 7);
        if (recentRaces.length > 0) {
            const ghostCount = ghostManager.loadRecentRacesAsGhosts(recentRaces);
            console.log(`Loaded ${ghostCount} ghost(s) from past races`);
        } else {
            console.log('No past races found - racing solo');
        }

        // Hide AI runners for ghost-based races
        for (const runner of aiRunners) {
            if (runner.model) runner.model.visible = false;
        }
    } else {
        // Load ghost from personal best for relay mode (if available)
        const pb = scoreboard.getPersonalBest(currentRaceMode);
        if (pb && pb.replayData && pb.replayData.length > 0) {
            ghostManager.addGhostFromEntry(pb, { lanePosition: 1.0 });
            console.log('Ghost loaded from personal best:', scoreboard.formatTime(pb.time));
        }
    }

    // Initialize relay manager for relay mode
    if (currentRaceMode === RACE_MODE.RELAY_4X100) {
        relayManager = new RelayManager(scene, inputManager);
    } else {
        relayManager = null;
    }

    // Get formation type for this mode
    const formationType = modeConfig ? getFormation(currentRaceMode) : { type: 'grouped', formation: RACE_FORMATION };

    if (formationType.type === 'lanes' || formationType.type === 'waterfall') {
        // Lane-based start (400m, relay, 1600m waterfall)
        // Player in lane 1
        const playerStagger = getStaggeredStartDistance(1, currentRaceMode);
        player.reset(playerStagger, LANE_FORMATION[0].lanePosition);

        // AI runners in lanes 2-8 (only if not using ghosts)
        if (!useGhostsInsteadOfAI) {
            for (let i = 0; i < aiRunners.length && i < 7; i++) {
                const runner = aiRunners[i];
                const laneData = LANE_FORMATION[i + 1]; // Lanes 2-8
                const stagger = getStaggeredStartDistance(laneData.lane, currentRaceMode);

                runner.reset(stagger, laneData.lanePosition);
                runner.assignedLane = laneData.lane;
                runner.assignedLanePosition = laneData.lanePosition;

                // Set lane lock for 400m and relay (stay in lane entire race)
                if (modeConfig && modeConfig.stayInLane) {
                    runner.setLaneLock(true, laneData.lane, laneData.lanePosition);
                }

                // Set waterfall mode for 1600m (break to lane 1 after first curve)
                if (formationType.type === 'waterfall') {
                    runner.setWaterfallMode(120); // Break after ~120m (end of first curve)
                }
            }
        }
    }

    // Start the race
    raceStarted = true;
    player.raceActive = true;
    raceTime = 0;
    updateClockDisplay(0);
    lastLapBellPlayed = false;

    // Reset replay recording
    raceReplayData = [];
    lastReplayRecordTime = 0;

    // Check if multiplayer mode
    isMultiplayer = window.isMultiplayer && networkManager.isConnected();
    if (isMultiplayer) {
        setupNetworkSync();

        // Create meshes for any remote players already in the lobby
        const remotePlayers = networkManager.getRemotePlayers();
        remotePlayers.forEach(p => {
            if (!remotePlayerMeshes.has(p.peerId)) {
                createRemotePlayerMesh(p);
            }
        });

        console.log('Multiplayer mode active with', remotePlayers.length, 'remote players');
    }

    // Start relay timer if applicable
    if (relayManager) {
        relayManager.startRace(0);
    }

    // Show race mode specific UI
    showRaceModeUI(currentRaceMode, modeConfig);

    // Hide HUD elements during race
    document.getElementById('startButton').style.display = 'none';
    document.getElementById('raceInfo').style.display = 'none';
    document.getElementById('info').style.display = 'none';

    console.log(`Race started! Mode: ${currentRaceMode || 'default'}, Distance: ${raceDistance}m`);
    console.log('  isMultiplayer:', isMultiplayer);
    console.log('  inputManager created:', !!inputManager);
    console.log('  modeConfig.inputType:', modeConfig?.inputType);

    // Enable focus warning for race
    if (window.setRaceActiveForFocus) {
        window.setRaceActiveForFocus(true);
    }
}

// Show race mode specific UI elements
function showRaceModeUI(raceMode, config) {
    // Show energy bar if applicable
    const energyContainer = document.getElementById('energyBarContainer');
    if (energyContainer) {
        if (config && config.energyType) {
            energyContainer.style.display = 'block';
            const label = document.getElementById('energyLabel');
            if (label) {
                if (config.energyType === ENERGY_TYPE.LACTIC_ACID) {
                    label.textContent = 'LACTIC ACID';
                } else if (config.energyType === ENERGY_TYPE.STAMINA_KICK) {
                    label.textContent = 'STAMINA';
                }
            }
        } else {
            energyContainer.style.display = 'none';
        }
    }

    // Show MPH display for arrow key modes
    const mphDisplay = document.getElementById('mphDisplay');
    if (mphDisplay) {
        if (config && config.inputType === INPUT_TYPE.ARROW_KEYS) {
            mphDisplay.style.display = 'block';
        } else {
            mphDisplay.style.display = 'none';
        }
    }

    // Show leg counter for relay
    const legCounter = document.getElementById('legCounter');
    if (legCounter) {
        if (raceMode === RACE_MODE.RELAY_4X100) {
            legCounter.style.display = 'block';
            legCounter.textContent = 'LEG 1/4';
        } else {
            legCounter.style.display = 'none';
        }
    }

    // Show lap counter for 1600m
    const lapCounter = document.getElementById('lapCounter');
    if (lapCounter) {
        if (raceMode === RACE_MODE.MILE_1600) {
            lapCounter.style.display = 'block';
            lapCounter.textContent = 'LAP 1/4';
        } else {
            lapCounter.style.display = 'none';
        }
    }
}

document.getElementById('startButton').addEventListener('click', (e) => {
    e.stopPropagation();
    // Hide the start button immediately
    document.getElementById('startButton').style.display = 'none';

    // Run countdown, then start race
    if (window.runCountdown) {
        window.runCountdown(() => {
            startRace();
        });
    } else {
        // Fallback if countdown not available
        startRace();
    }
});

// ============================================
// GOAL TIME PICKER
// ============================================

let selectedMinutes = 25;
let selectedSeconds = 0;

function populatePickers() {
    const minutesInner = document.getElementById('minutesInner');
    const secondsInner = document.getElementById('secondsInner');

    for (let m = 10; m <= 60; m++) {
        const div = document.createElement('div');
        div.className = 'scroll-option';
        div.textContent = m.toString().padStart(2, '0');
        div.dataset.value = m;
        div.addEventListener('click', () => scrollToOption(minutesPicker, m - 10));
        minutesInner.appendChild(div);
    }

    for (let s = 0; s <= 59; s++) {
        const div = document.createElement('div');
        div.className = 'scroll-option';
        div.textContent = s.toString().padStart(2, '0');
        div.dataset.value = s;
        div.addEventListener('click', () => scrollToOption(secondsPicker, s));
        secondsInner.appendChild(div);
    }
}

function scrollToOption(picker, index) {
    const optionHeight = 50;
    picker.scrollTo({ top: index * optionHeight, behavior: 'smooth' });
}

function updateSelectedFromScroll(picker, isMinutes) {
    const optionHeight = 50;
    const scrollTop = picker.scrollTop;
    const index = Math.round(scrollTop / optionHeight);

    const options = picker.querySelectorAll('.scroll-option');
    options.forEach((opt, i) => {
        opt.classList.toggle('selected', i === index);
    });

    if (isMinutes) {
        selectedMinutes = index + 10;
    } else {
        selectedSeconds = index;
    }
}

const minutesPicker = document.getElementById('minutesPicker');
const secondsPicker = document.getElementById('secondsPicker');

populatePickers();

setTimeout(() => {
    scrollToOption(minutesPicker, 15);
    scrollToOption(secondsPicker, 0);
    updateSelectedFromScroll(minutesPicker, true);
    updateSelectedFromScroll(secondsPicker, false);
}, 100);

minutesPicker.addEventListener('scroll', () => updateSelectedFromScroll(minutesPicker, true));
secondsPicker.addEventListener('scroll', () => updateSelectedFromScroll(secondsPicker, false));

document.getElementById('goalTimeSubmit').addEventListener('click', () => {
    const goalSeconds = selectedMinutes * 60 + selectedSeconds;

    if (goalSeconds < 600 || goalSeconds > 3600) {
        alert('Please select a valid time between 10:00 and 60:00');
        return;
    }

    userGoalTime = goalSeconds;
    const winnerTargetTime = goalSeconds - 10;
    timeScaleFactor = winnerTargetTime / ORIGINAL_WINNER_TIME;

    console.log(`Goal time: ${formatTime(goalSeconds)}, Winner target: ${formatTime(winnerTargetTime)}, Scale factor: ${timeScaleFactor.toFixed(3)}`);

    // Show view selection
    document.getElementById('goalTimeModal').style.display = 'none';
    document.getElementById('viewSelectModal').style.display = 'flex';
});

// View selection handlers
let selectedView = 'default';

document.querySelectorAll('.view-select-option').forEach(option => {
    option.addEventListener('click', () => {
        document.querySelectorAll('.view-select-option').forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        selectedView = option.dataset.view;
    });
});

document.getElementById('viewSelectSubmit').addEventListener('click', () => {
    // Apply the selected view
    setView(selectedView);

    // Also update settings modal to match
    document.querySelectorAll('.view-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.view === selectedView);
    });

    document.getElementById('viewSelectModal').style.display = 'none';
    // Treadmill message removed
    document.getElementById('startButton').style.display = 'block';

    // Only show pace slider for modes that use it (not arrow keys or spacebar mash)
    const selectedMode = window.raceMode;
    const modeConfig = selectedMode ? RACE_MODES[selectedMode] : null;
    const usesPaceSlider = !modeConfig || (!modeConfig.inputType);
    document.getElementById('paceSliderContainer').style.display = usesPaceSlider ? 'flex' : 'none';
});

// ============================================
// ANIMATION LOOP (defined below with path editor integration)
// ============================================

let prevTime = performance.now();

// ============================================
// WINDOW RESIZE
// ============================================

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============================================
// PATH EDITOR MODE
// ============================================

let pathEditorActive = false;
let pathEditorWaypoints = [];
let pathEditorKeys = { w: false, a: false, s: false, d: false, q: false, e: false, arrowup: false, arrowdown: false, arrowleft: false, arrowright: false, shift: false };
let pathEditorYaw = 0;
let pathEditorPitch = 0;
let pathEditorMarkers = [];

function startPathEditor() {
    pathEditorActive = true;
    pathEditorWaypoints = [];
    pathEditorYaw = 0;
    pathEditorPitch = 0;

    // Position camera above the map looking down initially
    camera.position.set(0, 50, 0);
    camera.rotation.set(-Math.PI / 2, 0, 0);

    // Show overlay
    document.getElementById('pathEditorOverlay').classList.add('active');
    document.getElementById('settingsModal').style.display = 'none';
    document.getElementById('info').style.display = 'none';
    document.getElementById('paceSliderContainer').style.display = 'none';
    document.getElementById('startButton').style.display = 'none';

    // Lock pointer for mouse look
    renderer.domElement.requestPointerLock();

    updatePathEditorHUD();
}

function stopPathEditor(exportPath = false) {
    pathEditorActive = false;
    document.getElementById('pathEditorOverlay').classList.remove('active');
    document.exitPointerLock();

    // Clear markers
    pathEditorMarkers.forEach(m => scene.remove(m));
    pathEditorMarkers = [];

    if (exportPath && pathEditorWaypoints.length > 0) {
        // Generate code with Y coordinates
        let code = 'const CITY_WAYPOINTS_RAW = [\n';
        pathEditorWaypoints.forEach((wp, i) => {
            code += `    { x: ${wp.x.toFixed(1)}, y: ${wp.y.toFixed(1)}, z: ${wp.z.toFixed(1)} },`;
            code += i < pathEditorWaypoints.length - 1 ? '\n' : '';
        });
        code += '\n];';

        document.getElementById('pathCode').textContent = code;
        document.getElementById('pathOutput').style.display = 'block';

        // Also log to console
        console.log('=== EXPORTED PATH ===');
        console.log(code);
    }

    // Restore UI
    document.getElementById('info').style.display = 'block';
}

function addPathWaypoint() {
    // Capture X, Y, and Z coordinates
    const wp = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    pathEditorWaypoints.push(wp);

    // Add visual marker at the waypoint position
    const markerGeom = new THREE.SphereGeometry(1, 8, 8);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0x44ff44 });
    const marker = new THREE.Mesh(markerGeom, markerMat);
    marker.position.set(wp.x, wp.y, wp.z);
    scene.add(marker);
    pathEditorMarkers.push(marker);

    // Add line to previous point
    if (pathEditorWaypoints.length > 1) {
        const prev = pathEditorWaypoints[pathEditorWaypoints.length - 2];
        const lineGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(prev.x, prev.y, prev.z),
            new THREE.Vector3(wp.x, wp.y, wp.z)
        ]);
        const lineMat = new THREE.LineBasicMaterial({ color: 0x44ff44 });
        const line = new THREE.Line(lineGeom, lineMat);
        scene.add(line);
        pathEditorMarkers.push(line);
    }

    updatePathEditorHUD();
    console.log(`Added waypoint ${pathEditorWaypoints.length}: (${wp.x.toFixed(1)}, ${wp.y.toFixed(1)}, ${wp.z.toFixed(1)})`);
}

function undoPathWaypoint() {
    if (pathEditorWaypoints.length > 0) {
        pathEditorWaypoints.pop();
        // Remove marker
        if (pathEditorMarkers.length > 0) {
            const marker = pathEditorMarkers.pop();
            scene.remove(marker);
        }
        // Remove line if exists
        if (pathEditorWaypoints.length > 0 && pathEditorMarkers.length > 0) {
            const line = pathEditorMarkers.pop();
            scene.remove(line);
        }
        updatePathEditorHUD();
    }
}

function updatePathEditorHUD() {
    document.getElementById('editorX').textContent = camera.position.x.toFixed(1);
    document.getElementById('editorY').textContent = camera.position.y.toFixed(1);
    document.getElementById('editorZ').textContent = camera.position.z.toFixed(1);
    document.getElementById('pointCount').textContent = pathEditorWaypoints.length;
}

function updatePathEditorMovement(delta) {
    if (!pathEditorActive) return;

    const baseSpeed = 15 * delta;
    const speed = pathEditorKeys.shift ? baseSpeed * 10 : baseSpeed;
    const direction = new THREE.Vector3();

    // Forward/back based on yaw (W or Up Arrow)
    if (pathEditorKeys.w || pathEditorKeys.arrowup) {
        direction.x -= Math.sin(pathEditorYaw) * speed;
        direction.z -= Math.cos(pathEditorYaw) * speed;
    }
    if (pathEditorKeys.s || pathEditorKeys.arrowdown) {
        direction.x += Math.sin(pathEditorYaw) * speed;
        direction.z += Math.cos(pathEditorYaw) * speed;
    }
    // Strafe (A/D or Left/Right Arrow)
    if (pathEditorKeys.a || pathEditorKeys.arrowleft) {
        direction.x -= Math.cos(pathEditorYaw) * speed;
        direction.z += Math.sin(pathEditorYaw) * speed;
    }
    if (pathEditorKeys.d || pathEditorKeys.arrowright) {
        direction.x += Math.cos(pathEditorYaw) * speed;
        direction.z -= Math.sin(pathEditorYaw) * speed;
    }
    // Up/down
    if (pathEditorKeys.q) direction.y -= speed;
    if (pathEditorKeys.e) direction.y += speed;

    camera.position.add(direction);

    // Apply rotation
    camera.rotation.order = 'YXZ';
    camera.rotation.y = pathEditorYaw;
    camera.rotation.x = pathEditorPitch;

    updatePathEditorHUD();
}

// Path editor key handlers
document.addEventListener('keydown', (e) => {
    if (!pathEditorActive) return;

    const key = e.key.toLowerCase();
    if (key in pathEditorKeys) pathEditorKeys[key] = true;
    if (e.shiftKey) pathEditorKeys.shift = true;

    if (e.code === 'Space') {
        e.preventDefault();
        addPathWaypoint();
    }
    if (e.code === 'Backspace') {
        e.preventDefault();
        undoPathWaypoint();
    }
});

document.addEventListener('keyup', (e) => {
    if (!pathEditorActive) return;
    const key = e.key.toLowerCase();
    if (key in pathEditorKeys) pathEditorKeys[key] = false;
    if (!e.shiftKey) pathEditorKeys.shift = false;
});

document.addEventListener('mousemove', (e) => {
    if (!pathEditorActive || document.pointerLockElement !== renderer.domElement) return;

    pathEditorYaw -= e.movementX * 0.002;
    pathEditorPitch -= e.movementY * 0.002;
    pathEditorPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pathEditorPitch));
});

// Click to re-lock pointer for mouse look
renderer.domElement.addEventListener('click', () => {
    if (pathEditorActive && document.pointerLockElement !== renderer.domElement) {
        renderer.domElement.requestPointerLock();
    }
});

// UI button handlers
setTimeout(() => {
    const startBtn = document.getElementById('startPathEditor');
    const finishBtn = document.getElementById('finishPathEditor');
    const cancelBtn = document.getElementById('cancelPathEditor');
    const closeBtn = document.getElementById('closePathOutput');

    if (startBtn) {
        startBtn.addEventListener('click', () => {
            console.log('Starting path editor...');
            startPathEditor();
        });
        console.log('Path editor button ready');
    } else {
        console.error('startPathEditor button not found!');
    }

    if (finishBtn) finishBtn.addEventListener('click', () => stopPathEditor(true));
    if (cancelBtn) cancelBtn.addEventListener('click', () => stopPathEditor(false));
    if (closeBtn) closeBtn.addEventListener('click', () => {
        document.getElementById('pathOutput').style.display = 'none';
    });
}, 100);

// Main animation loop with path editor integration
function animateWithPathEditor() {
    requestAnimationFrame(animateWithPathEditor);

    const time = performance.now();
    const delta = (time - prevTime) / 1000;
    prevTime = time;

    if (pathEditorActive) {
        updatePathEditorMovement(delta);
        renderer.render(scene, camera);
        return;
    }

    // Update city water waves and traffic
    updateCityWater(time);
    updateCityCars(delta);

    // Update confetti animation
    updateConfetti(delta);

    // Victory lap - player jogs slowly after winning
    if (victoryLapActive && playerGhost) {
        player.distance += victoryLapSpeed * delta;

        const ghostPos = getPosition(player.distance, player.lanePosition);
        const groundY = ghostPos.y || 0;
        playerGhost.position.set(ghostPos.x, groundY, ghostPos.z);
        // Apply base rotation plus model-specific offset
        const playerGhostOffset = MODEL_ROTATION_OFFSETS[window.playerCharacter] || 0;
        playerGhost.rotation.y = ghostPos.rotation + playerGhostOffset;

        // Update player camera to follow
        player.update(delta, time, []);

        // Slow jog animation
        if (playerGhostMixer) {
            playerGhostMixer.update(delta * 0.5);
        }
    }

    if (raceStarted) {
        // Update input manager
        if (inputManager) {
            inputManager.update(delta);
        }

        // Get player speed based on input mode
        let playerSpeed = player.paceToSpeed(); // Default pace-based
        const modeConfig = currentRaceMode ? RACE_MODES[currentRaceMode] : null;

        if (inputManager && modeConfig) {
            if (modeConfig.inputType === INPUT_TYPE.SPACEBAR_MASH) {
                // Relay: speed from spacebar mashing
                playerSpeed = inputManager.currentSpeed;
            } else if (modeConfig.inputType === INPUT_TYPE.ARROW_KEYS) {
                // 400m/1600m: speed from arrow keys
                playerSpeed = inputManager.currentSpeed;
            }
        }

        // Apply energy system effects
        let energySpeedMultiplier = 1.0;
        if (energySystem && modeConfig) {
            // Check if drafting (for 1600m stamina mode)
            const isDrafting = aiRunners.some(runner => {
                const distDiff = runner.distance - player.distance;
                const laneDiff = Math.abs(runner.lanePosition - player.lanePosition);
                return distDiff > 0.5 && distDiff < 2.0 && laneDiff < 0.3;
            });

            energySpeedMultiplier = energySystem.update(playerSpeed, delta, isDrafting, player.distance);

            // Update energy bar UI
            updateEnergyUI(energySystem, modeConfig);

            // Check for DNF (lactic acid full)
            if (energySystem.isDNF && energySystem.isDNF()) {
                handleDNF();
            }
        }

        // Apply speed multiplier from energy
        playerSpeed *= energySpeedMultiplier;

        // Get remote runners for collision detection
        const remoteRunners = isMultiplayer ? getRemoteRunnersForCollision() : [];

        // Update player distance (custom speed for new modes)
        if (modeConfig && (modeConfig.inputType === INPUT_TYPE.SPACEBAR_MASH || modeConfig.inputType === INPUT_TYPE.ARROW_KEYS)) {
            player.distance += playerSpeed * delta;
            // Still update camera position and lane movement, but skip distance update (we handle it above)
            player.update(delta, time, aiRunners, inputManager, remoteRunners, true);
        } else {
            // Default pace-based update
            player.update(delta, time, aiRunners, inputManager, remoteRunners);
        }

        // Send network update in multiplayer mode
        if (isMultiplayer) {
            sendNetworkUpdate();
            updateRemotePlayerAnimations(delta);
        }

        // Update relay manager (exchange zones, handoffs)
        if (relayManager) {
            relayManager.update(delta, raceTime, player.distance, player, playerSpeed);

            // Update leg counter UI
            const legCounter = document.getElementById('legCounter');
            if (legCounter) {
                legCounter.textContent = `LEG ${relayManager.getCurrentLegDisplay()}/4`;
            }

            // Update exchange zone indicator
            const exchangeIndicator = document.getElementById('exchangeZoneIndicator');
            if (exchangeIndicator) {
                if (relayManager.isInExchangeZone()) {
                    exchangeIndicator.style.display = 'block';
                } else {
                    exchangeIndicator.style.display = 'none';
                }
            }

            // Check for relay end (success or failure)
            if (relayManager.isRaceOver()) {
                const result = relayManager.getRaceResult();
                // Relay solo time trial - always a "winner" if completed successfully
                if (result.success) {
                    result.isWinner = true;
                }
                handleRaceEnd(result);
            }
        }

        // Update ghost runners
        if (ghostManager) {
            ghostManager.update(raceTime);
        }

        // Update MPH display
        if (inputManager) {
            const mphDisplay = document.getElementById('mphDisplay');
            if (mphDisplay && mphDisplay.style.display !== 'none') {
                mphDisplay.textContent = `${inputManager.getSpeedMPH().toFixed(1)} MPH`;
            }
        }

        // Update lap counter for 1600m
        if (currentRaceMode === RACE_MODE.MILE_1600) {
            const currentLap = getCurrentLap(player.distance, currentRaceMode);
            const lapCounter = document.getElementById('lapCounter');
            if (lapCounter) {
                lapCounter.textContent = `LAP ${Math.min(currentLap, 4)}/4`;
            }

            // Check for kick phase transition
            if (energySystem && isInKickPhase(player.distance, currentRaceMode) && !energySystem.inKickPhase) {
                energySystem.enterKickPhase();
                const energyLabel = document.getElementById('energyLabel');
                if (energyLabel) {
                    energyLabel.textContent = 'KICK';
                }
            }
        }

        // Update race time and clock
        raceTime += delta;
        updateClockDisplay(raceTime);

        // Record replay data (for ghost playback of past races)
        if (!relayManager && raceTime - lastReplayRecordTime >= REPLAY_RECORD_INTERVAL) {
            raceReplayData.push({
                time: raceTime,
                distance: player.distance,
                lanePosition: player.lanePosition
            });
            lastReplayRecordTime = raceTime;
        }

        // Check for Celica trigger (only in non-relay modes)
        if (!relayManager && aiRunners.length > 0) {
            const leader = aiRunners.reduce((max, r) => r.distance > max.distance ? r : max, aiRunners[0]);
            celica.checkTrigger(leader.distance);
        }

        // Update Celica
        celica.update(delta, aiRunners, camera);

        // Update AI runners (skip if using ghosts from past races)
        if (!useGhostsInsteadOfAI) {
            for (const runner of aiRunners) {
                runner.update(delta, timeScaleFactor, aiRunners, raceDistance);
            }
        }

        // Update player ghost (selected character following player position)
        if (playerGhost) {
            // Show ghost only in third-person mode
            playerGhost.visible = (player.cameraMode === 'third-person');

            const ghostPos = getPosition(player.distance, player.lanePosition);
            const groundY = ghostPos.y || 0;
            playerGhost.position.set(ghostPos.x, groundY, ghostPos.z);
            // Apply base rotation plus model-specific offset
            const playerGhostOffset = MODEL_ROTATION_OFFSETS[window.playerCharacter] || 0;
            playerGhost.rotation.y = ghostPos.rotation + playerGhostOffset;

            if (playerGhostMixer) {
                // Speed up animation based on player speed
                const speedMultiplier = playerSpeed / 3; // Base animation speed ratio
                playerGhostMixer.update(delta * Math.max(0.3, speedMultiplier));
            }
        }

        // Resolve collisions (skip for relay solo mode and ghost mode)
        if (!relayManager && !useGhostsInsteadOfAI && aiRunners.length > 0) {
            resolveCollisions(player, aiRunners, delta);
        }

        // Check for last lap bell (1600m - final 400m)
        if (!lastLapBellPlayed && currentRaceMode === RACE_MODE.MILE_1600) {
            const bellDistance = raceDistance - 400; // Last 400m

            const checkDistance = aiRunners.length > 0
                ? Math.max(player.distance, ...aiRunners.map(r => r.distance))
                : player.distance;

            if (checkDistance >= bellDistance) {
                playLastLapBell(1.0);
                lastLapBellPlayed = true;
                console.log('Last lap bell!');
            }
        }

        // Check for race finish
        checkRaceFinish();
    } else {
        // Keep animations paused before race
        for (const runner of aiRunners) {
            if (runner.mixer) {
                runner.mixer.update(0);
            }
        }
    }

    renderer.render(scene, camera);
}

// ============================================
// WINNER CELEBRATION SYSTEM
// ============================================

let confettiParticles = [];
let confettiCanvas = null;
let confettiCtx = null;
let confettiActive = false;
let victoryLapActive = false;
let victoryLapSpeed = 2.0; // Slow jog speed (m/s)

function initConfetti() {
    confettiCanvas = document.getElementById('confettiCanvas');
    if (confettiCanvas) {
        confettiCanvas.width = window.innerWidth;
        confettiCanvas.height = window.innerHeight;
        confettiCtx = confettiCanvas.getContext('2d');
    }
}

function createConfettiParticle() {
    // Shades of green for the confetti
    const greens = [
        '#00ff00', '#00cc00', '#00ee00', '#33ff33',
        '#66ff66', '#00aa00', '#22dd22', '#44ff44',
        '#00ff44', '#44ff00', '#88ff88', '#00dd44'
    ];

    return {
        x: Math.random() * window.innerWidth,
        y: -20,
        width: Math.random() * 10 + 5,
        height: Math.random() * 6 + 3,
        color: greens[Math.floor(Math.random() * greens.length)],
        velocityX: (Math.random() - 0.5) * 8,
        velocityY: Math.random() * 3 + 2,
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 15,
        wobble: Math.random() * Math.PI * 2,
        wobbleSpeed: Math.random() * 0.1 + 0.05
    };
}

function spawnConfettiBurst(count = 100) {
    for (let i = 0; i < count; i++) {
        const particle = createConfettiParticle();
        // Spawn from different positions for burst effect
        particle.x = window.innerWidth / 2 + (Math.random() - 0.5) * 400;
        particle.y = window.innerHeight / 3;
        particle.velocityX = (Math.random() - 0.5) * 20;
        particle.velocityY = -Math.random() * 15 - 5;
        confettiParticles.push(particle);
    }
}

function updateConfetti(delta) {
    if (!confettiCtx || !confettiActive) return;

    // Clear canvas
    confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);

    // Spawn new particles occasionally
    if (confettiParticles.length < 200 && Math.random() < 0.3) {
        confettiParticles.push(createConfettiParticle());
    }

    // Update and draw particles
    for (let i = confettiParticles.length - 1; i >= 0; i--) {
        const p = confettiParticles[i];

        // Physics
        p.velocityY += 0.2; // Gravity
        p.x += p.velocityX;
        p.y += p.velocityY;
        p.rotation += p.rotationSpeed;
        p.wobble += p.wobbleSpeed;
        p.x += Math.sin(p.wobble) * 2; // Side-to-side wobble

        // Draw
        confettiCtx.save();
        confettiCtx.translate(p.x, p.y);
        confettiCtx.rotate(p.rotation * Math.PI / 180);
        confettiCtx.fillStyle = p.color;
        confettiCtx.fillRect(-p.width / 2, -p.height / 2, p.width, p.height);
        confettiCtx.restore();

        // Remove if off screen
        if (p.y > window.innerHeight + 50) {
            confettiParticles.splice(i, 1);
        }
    }
}

function startWinnerCelebration() {
    console.log('WINNER! Starting celebration...');

    // Show winner overlay
    const winnerOverlay = document.getElementById('winnerOverlay');
    if (winnerOverlay) {
        winnerOverlay.style.display = 'flex';
    }

    // Initialize and start confetti
    initConfetti();
    confettiActive = true;

    // Multiple confetti bursts
    spawnConfettiBurst(150);
    setTimeout(() => spawnConfettiBurst(100), 300);
    setTimeout(() => spawnConfettiBurst(100), 600);
    setTimeout(() => spawnConfettiBurst(80), 1000);

    // Start victory lap
    victoryLapActive = true;

    // Hide winner text after 3 seconds but keep confetti and victory lap
    setTimeout(() => {
        const winnerOverlay = document.getElementById('winnerOverlay');
        if (winnerOverlay) {
            winnerOverlay.style.display = 'none';
        }
    }, 3000);

    // Stop confetti after 5 seconds
    setTimeout(() => {
        confettiActive = false;
        if (confettiCtx) {
            confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
        }
        confettiParticles = [];
    }, 5000);

    // Show post-race modal after celebration (for multiplayer) or restart button (for solo)
    setTimeout(() => {
        if (window.showPostRaceModal) {
            window.showPostRaceModal(raceTime);
        } else {
            // Fallback to restart button
            document.getElementById('startButton').textContent = 'RACE AGAIN';
            document.getElementById('startButton').style.display = 'block';
        }
    }, 3500);
}

function stopWinnerCelebration() {
    confettiActive = false;
    victoryLapActive = false;
    confettiParticles = [];

    const winnerOverlay = document.getElementById('winnerOverlay');
    if (winnerOverlay) {
        winnerOverlay.style.display = 'none';
    }

    if (confettiCtx) {
        confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    }
}

// Helper functions for race mode handling
function updateEnergyUI(system, config) {
    const energyBar = document.getElementById('energyBar');
    const energyFill = document.getElementById('energyFill');
    if (!energyBar || !energyFill) return;

    let level = 0;
    let color = '#00ff00';

    if (config.energyType === ENERGY_TYPE.LACTIC_ACID) {
        level = system.level;
        // Color goes from green to yellow to red as lactic acid builds
        if (level < 50) {
            color = `rgb(${Math.floor(level * 5.1)}, 255, 0)`;
        } else {
            color = `rgb(255, ${Math.floor((100 - level) * 5.1)}, 0)`;
        }
    } else if (config.energyType === ENERGY_TYPE.STAMINA_KICK) {
        if (system.inKickPhase) {
            level = system.kickBar;
        } else {
            level = system.stamina;
        }
        // Green when full, yellow when medium, red when low
        if (level > 60) {
            color = '#00ff00';
        } else if (level > 30) {
            color = '#ffff00';
        } else {
            color = '#ff0000';
        }
    }

    energyFill.style.width = `${level}%`;
    energyFill.style.backgroundColor = color;
}

function handleDNF() {
    console.log('DNF - Lactic acid overload!');
    raceStarted = false;
    player.raceActive = false;

    // Show DNF screen
    const dnfOverlay = document.getElementById('dnfOverlay');
    if (dnfOverlay) {
        dnfOverlay.style.display = 'flex';
    }

    // Show restart button
    document.getElementById('startButton').textContent = 'RESTART RACE';
    document.getElementById('startButton').style.display = 'block';
}

function handleRaceEnd(result) {
    raceStarted = false;
    player.raceActive = false;

    // Disable focus warning
    if (window.setRaceActiveForFocus) {
        window.setRaceActiveForFocus(false);
    }

    // Clean up multiplayer state
    if (isMultiplayer) {
        // Send finish notification to other players
        networkManager.sendFinish(result.totalTime || raceTime);

        // Clean up remote player meshes using proper disposal
        const peerIds = Array.from(remotePlayerMeshes.keys());
        peerIds.forEach(peerId => removeRemotePlayerMesh(peerId));

        isMultiplayer = false;
    }

    if (result.success) {
        console.log(`Race complete! Time: ${formatTime(result.totalTime)}`);

        // Save to scoreboard
        scoreboard.saveResult(currentRaceMode, result);

        // Check for personal best
        if (scoreboard.isNewPersonalBest(currentRaceMode, result.totalTime)) {
            console.log('NEW PERSONAL BEST!');
        }

        // Check if player won and trigger celebration
        if (result.isWinner) {
            startWinnerCelebration();
            return; // Winner celebration handles the restart button
        }
    } else {
        console.log(`Race failed: ${result.message}`);
    }

    // Show restart button
    document.getElementById('startButton').textContent = 'RACE AGAIN';
    document.getElementById('startButton').style.display = 'block';
}

function checkRaceFinish() {
    // Check if player finished first (WINNER!)
    if (player.distance >= raceDistance) {
        // Relay is handled separately by RelayManager
        if (currentRaceMode === RACE_MODE.RELAY_4X100) return;

        // Check if player finished before all AI runners
        const playerWon = aiRunners.every(r => !r.finished || r.distance < raceDistance);

        // 400m or 1600m finish
        if (currentRaceMode === RACE_MODE.SPRINT_400 || currentRaceMode === RACE_MODE.MILE_1600) {
            const result = {
                success: true,
                totalTime: raceTime,
                replayData: raceReplayData,
                isWinner: playerWon
            };
            handleRaceEnd(result);
            return;
        }

    }
}

// Replace the original animate loop
// Stop the original loop by not calling it again
// Start the new one
animateWithPathEditor();
