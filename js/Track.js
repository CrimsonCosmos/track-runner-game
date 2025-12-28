import * as THREE from 'three';

// Track geometry constants
export const STRAIGHT_LENGTH = 84.39;
export const INNER_RADIUS = 36.5;
export const LANE_WIDTH = 1.22;
export const NUM_LANES = 8;
export const TRACK_WIDTH = LANE_WIDTH * NUM_LANES;

// Calculate track length for a given lane
export function getTrackLength(lane) {
    const radius = INNER_RADIUS + (lane - 0.5) * LANE_WIDTH;
    return (STRAIGHT_LENGTH * 2) + (2 * Math.PI * radius);
}

// Get position and rotation on track given distance traveled and lane
export function getTrackPosition(distance, lane) {
    const radius = INNER_RADIUS + (lane - 0.5) * LANE_WIDTH;
    const trackLength = getTrackLength(lane);

    // Normalize distance to track length (loop)
    distance = distance % trackLength;

    const halfStraight = STRAIGHT_LENGTH / 2;
    const curveLength = Math.PI * radius;

    let x, z, rotation;

    const seg1End = STRAIGHT_LENGTH;
    const seg2End = seg1End + curveLength;
    const seg3End = seg2End + STRAIGHT_LENGTH;

    if (distance < seg1End) {
        // Bottom straight - running from right to left
        const progress = distance;
        x = halfStraight - progress;
        z = -radius;
        rotation = Math.PI;
    } else if (distance < seg2End) {
        // Left curve
        const curveProgress = distance - seg1End;
        const angle = -Math.PI/2 - (curveProgress / radius);
        x = -halfStraight + Math.cos(angle) * radius;
        z = Math.sin(angle) * radius;
        rotation = angle - Math.PI/2;
    } else if (distance < seg3End) {
        // Top straight - running from left to right
        const progress = distance - seg2End;
        x = -halfStraight + progress;
        z = radius;
        rotation = 0;
    } else {
        // Right curve
        const curveProgress = distance - seg3End;
        const angle = Math.PI/2 - (curveProgress / radius);
        x = halfStraight + Math.cos(angle) * radius;
        z = Math.sin(angle) * radius;
        rotation = angle - Math.PI/2;
    }

    return { x, z, rotation };
}

// Create track texture
function createTrackTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, 512, 512);

    for (let i = 0; i < 50000; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const brightness = Math.random() * 30;
        ctx.fillStyle = `rgb(${26 + brightness}, ${26 + brightness}, ${26 + brightness})`;
        ctx.fillRect(x, y, 1, 1);
    }

    ctx.strokeStyle = 'rgba(50, 50, 50, 0.3)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 100; i++) {
        ctx.beginPath();
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.random() * 20 - 10, y + Math.random() * 20 - 10);
        ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(20, 20);
    return texture;
}

// Create track normal map
function createTrackNormalMap() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#8080ff';
    ctx.fillRect(0, 0, 256, 256);

    for (let i = 0; i < 2000; i++) {
        const x = Math.random() * 256;
        const y = Math.random() * 256;
        const r = Math.random() * 3 + 1;
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
        gradient.addColorStop(0, 'rgba(180, 180, 255, 0.3)');
        gradient.addColorStop(1, 'rgba(128, 128, 255, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(20, 20);
    return texture;
}

// Create the track geometry
function createTrackGeometry() {
    const shape = new THREE.Shape();
    const outerRadius = INNER_RADIUS + TRACK_WIDTH;
    const halfStraight = STRAIGHT_LENGTH / 2;

    shape.moveTo(-halfStraight, -(outerRadius));
    shape.lineTo(halfStraight, -(outerRadius));
    shape.absarc(halfStraight, 0, outerRadius, -Math.PI / 2, Math.PI / 2, false);
    shape.lineTo(-halfStraight, outerRadius);
    shape.absarc(-halfStraight, 0, outerRadius, Math.PI / 2, -Math.PI / 2, false);

    const hole = new THREE.Path();
    hole.moveTo(-halfStraight, -INNER_RADIUS);
    hole.lineTo(halfStraight, -INNER_RADIUS);
    hole.absarc(halfStraight, 0, INNER_RADIUS, -Math.PI / 2, Math.PI / 2, false);
    hole.lineTo(-halfStraight, INNER_RADIUS);
    hole.absarc(-halfStraight, 0, INNER_RADIUS, Math.PI / 2, -Math.PI / 2, false);
    shape.holes.push(hole);

    const geometry = new THREE.ShapeGeometry(shape, 64);
    geometry.rotateX(-Math.PI / 2);
    return geometry;
}

// Create lane markings
function createLaneMarkings(scene) {
    const markingsGroup = new THREE.Group();
    const lineMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.6,
        metalness: 0.0
    });

    const lineWidth = 0.05;
    const lineHeight = 0.005;
    const halfStraight = STRAIGHT_LENGTH / 2;
    const curveSegments = 128;

    for (let lane = 0; lane <= NUM_LANES; lane++) {
        const radius = INNER_RADIUS + (lane * LANE_WIDTH);

        // Right curve
        for (let i = 0; i < curveSegments; i++) {
            const angle1 = -Math.PI / 2 + (Math.PI * i / curveSegments);
            const angle2 = -Math.PI / 2 + (Math.PI * (i + 1) / curveSegments);
            const x1 = halfStraight + Math.cos(angle1) * radius;
            const z1 = Math.sin(angle1) * radius;
            const x2 = halfStraight + Math.cos(angle2) * radius;
            const z2 = Math.sin(angle2) * radius;
            const length = Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2);
            const lineGeom = new THREE.BoxGeometry(length + 0.01, lineHeight, lineWidth);
            const lineMesh = new THREE.Mesh(lineGeom, lineMaterial);
            lineMesh.position.set((x1 + x2) / 2, lineHeight / 2 + 0.01, (z1 + z2) / 2);
            lineMesh.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
            markingsGroup.add(lineMesh);
        }

        // Left curve
        for (let i = 0; i < curveSegments; i++) {
            const angle1 = Math.PI / 2 + (Math.PI * i / curveSegments);
            const angle2 = Math.PI / 2 + (Math.PI * (i + 1) / curveSegments);
            const x1 = -halfStraight + Math.cos(angle1) * radius;
            const z1 = Math.sin(angle1) * radius;
            const x2 = -halfStraight + Math.cos(angle2) * radius;
            const z2 = Math.sin(angle2) * radius;
            const length = Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2);
            const lineGeom = new THREE.BoxGeometry(length + 0.01, lineHeight, lineWidth);
            const lineMesh = new THREE.Mesh(lineGeom, lineMaterial);
            lineMesh.position.set((x1 + x2) / 2, lineHeight / 2 + 0.01, (z1 + z2) / 2);
            lineMesh.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
            markingsGroup.add(lineMesh);
        }

        // Straights
        const straightGeom = new THREE.BoxGeometry(STRAIGHT_LENGTH, lineHeight, lineWidth);
        const bottomLine = new THREE.Mesh(straightGeom, lineMaterial);
        bottomLine.position.set(0, lineHeight / 2 + 0.01, -radius);
        markingsGroup.add(bottomLine);

        const topLine = new THREE.Mesh(straightGeom, lineMaterial);
        topLine.position.set(0, lineHeight / 2 + 0.01, radius);
        markingsGroup.add(topLine);
    }

    // Finish line
    const finishGeom = new THREE.BoxGeometry(0.1, lineHeight, TRACK_WIDTH);
    const finishLine = new THREE.Mesh(finishGeom, lineMaterial);
    finishLine.position.set(-STRAIGHT_LENGTH / 4, lineHeight / 2 + 0.015, -(INNER_RADIUS + TRACK_WIDTH / 2));
    markingsGroup.add(finishLine);

    return markingsGroup;
}

// Create infield grass
function createInfield() {
    const shape = new THREE.Shape();
    const halfStraight = STRAIGHT_LENGTH / 2;
    shape.moveTo(-halfStraight, -INNER_RADIUS);
    shape.lineTo(halfStraight, -INNER_RADIUS);
    shape.absarc(halfStraight, 0, INNER_RADIUS, -Math.PI / 2, Math.PI / 2, false);
    shape.lineTo(-halfStraight, INNER_RADIUS);
    shape.absarc(-halfStraight, 0, INNER_RADIUS, Math.PI / 2, -Math.PI / 2, false);

    const geometry = new THREE.ShapeGeometry(shape, 64);
    geometry.rotateX(-Math.PI / 2);

    const grassCanvas = document.createElement('canvas');
    grassCanvas.width = 256;
    grassCanvas.height = 256;
    const ctx = grassCanvas.getContext('2d');
    ctx.fillStyle = '#2d5a27';
    ctx.fillRect(0, 0, 256, 256);

    for (let i = 0; i < 10000; i++) {
        const x = Math.random() * 256;
        const y = Math.random() * 256;
        const green = 40 + Math.random() * 50;
        ctx.fillStyle = `rgb(${20 + Math.random() * 20}, ${green + 50}, ${20 + Math.random() * 20})`;
        ctx.fillRect(x, y, 1, 2);
    }

    const grassTexture = new THREE.CanvasTexture(grassCanvas);
    grassTexture.wrapS = THREE.RepeatWrapping;
    grassTexture.wrapT = THREE.RepeatWrapping;
    grassTexture.repeat.set(15, 15);

    const material = new THREE.MeshStandardMaterial({
        map: grassTexture,
        roughness: 0.9,
        metalness: 0.0
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.position.y = -0.01;
    return mesh;
}

// Store track objects for visibility control
export const trackObjects = [];

// ============================================
// CITY STREET PATH SYSTEM
// ============================================

// City perimeter waypoints - traced using path editor
const CITY_WAYPOINTS_RAW = [
    { x: -249.9, z: -429.2 },
    { x: -281.2, z: -416.7 },
    { x: -338.4, z: -395.4 },
    { x: -397.7, z: -371.7 },
    { x: -472.1, z: -336.3 },
    { x: -564.0, z: -295.1 },
    { x: -641.3, z: -254.1 },
    { x: -705.2, z: -218.0 },
    { x: -760.5, z: -192.8 },
    { x: -864.0, z: -142.9 },
    { x: -947.1, z: -64.9 },
    { x: -1012.1, z: 8.8 },
    { x: -1053.7, z: 74.0 },
    { x: -1071.1, z: 126.9 },
    { x: -1081.9, z: 202.8 },
    { x: -1078.7, z: 283.8 },
    { x: -1063.9, z: 319.9 },
    { x: -1048.8, z: 340.9 },
    { x: -1034.4, z: 358.2 },
    { x: -1018.2, z: 372.6 },
    { x: -1003.4, z: 380.3 },
    { x: -970.3, z: 388.3 },
    { x: -928.9, z: 393.2 },
    { x: -914.0, z: 395.3 },
    { x: -894.3, z: 398.4 },
    { x: -860.3, z: 402.3 },
    { x: -839.7, z: 405.6 },
    { x: -817.5, z: 409.2 },
    { x: -791.5, z: 415.1 },
    { x: -763.1, z: 421.8 },
    { x: -739.0, z: 428.2 },
    { x: -709.0, z: 435.3 },
    { x: -687.5, z: 437.5 },
    { x: -668.3, z: 437.6 },
    { x: -647.6, z: 435.3 },
    { x: -633.9, z: 432.0 },
    { x: -615.6, z: 426.1 },
    { x: -602.5, z: 420.9 },
    { x: -589.3, z: 415.8 },
    { x: -580.3, z: 414.2 },
    { x: -571.1, z: 414.0 },
    { x: -560.3, z: 413.8 },
    { x: -552.1, z: 412.5 },
    { x: -542.2, z: 411.0 },
    { x: -535.5, z: 407.7 },
    { x: -527.3, z: 403.6 },
    { x: -519.9, z: 396.8 },
    { x: -504.7, z: 385.2 },
    { x: -500.9, z: 380.8 },
    { x: -495.3, z: 373.5 },
    { x: -490.7, z: 365.7 },
    { x: -486.1, z: 354.0 },
    { x: -482.5, z: 342.0 },
    { x: -480.4, z: 333.1 },
    { x: -478.1, z: 323.4 },
    { x: -475.5, z: 312.8 },
    { x: -474.4, z: 306.3 },
    { x: -472.9, z: 298.1 },
    { x: -470.3, z: 291.9 },
    { x: -462.4, z: 278.2 },
    { x: -460.8, z: 275.3 },
    { x: -452.3, z: 262.0 },
    { x: -447.8, z: 255.0 },
    { x: -439.2, z: 242.7 },
    { x: -436.2, z: 238.7 },
    { x: -433.1, z: 234.7 },
    { x: -429.3, z: 231.4 },
    { x: -417.9, z: 221.7 },
    { x: -412.2, z: 216.8 },
    { x: -393.8, z: 205.4 },
    { x: -382.5, z: 198.3 },
    { x: -371.2, z: 191.3 },
    { x: -358.5, z: 183.4 },
    { x: -351.4, z: 179.0 },
    { x: -344.7, z: 174.2 },
    { x: -336.5, z: 168.3 },
    { x: -330.1, z: 164.4 },
    { x: -317.9, z: 157.3 },
    { x: -300.9, z: 148.3 },
    { x: -295.8, z: 145.6 },
    { x: -275.7, z: 135.5 },
    { x: -266.7, z: 131.0 },
    { x: -252.5, z: 124.1 },
    { x: -232.3, z: 114.2 },
    { x: -208.3, z: 102.5 },
    { x: -200.1, z: 98.4 },
    { x: -189.6, z: 93.2 },
    { x: -180.7, z: 88.8 },
    { x: -176.9, z: 86.9 },
    { x: -166.3, z: 82.2 },
    { x: -143.9, z: 73.0 },
    { x: -135.5, z: 69.6 },
    { x: -130.8, z: 67.7 },
    { x: -127.8, z: 66.4 },
    { x: -124.7, z: 65.2 },
    { x: -121.7, z: 63.7 },
    { x: -117.6, z: 60.8 },
    { x: -113.1, z: 57.1 },
    { x: -109.5, z: 55.1 },
    { x: -105.7, z: 53.3 },
    { x: -101.9, z: 51.6 },
    { x: -98.1, z: 49.8 },
    { x: -95.4, z: 47.9 },
    { x: -91.9, z: 45.6 },
    { x: -88.7, z: 44.7 },
    { x: -84.7, z: 43.5 },
    { x: -78.3, z: 41.6 },
    { x: -64.9, z: 36.9 },
    { x: -54.4, z: 34.2 },
    { x: -50.4, z: 33.2 },
    { x: -41.3, z: 31.6 },
    { x: -25.7, z: 28.6 },
    { x: -21.6, z: 28.4 },
    { x: -5.8, z: 27.4 },
    { x: 2.6, z: 27.1 },
    { x: 13.4, z: 27.0 },
    { x: 22.5, z: 26.8 },
    { x: 30.1, z: 27.0 },
    { x: 39.3, z: 27.0 },
    { x: 47.5, z: 26.8 },
    { x: 54.2, z: 26.6 },
    { x: 60.0, z: 26.4 },
    { x: 77.3, z: 23.7 },
    { x: 90.4, z: 20.9 },
    { x: 97.6, z: 19.0 },
    { x: 110.6, z: 15.6 },
    { x: 113.0, z: 15.0 },
    { x: 127.5, z: 8.8 },
    { x: 135.1, z: 5.5 },
    { x: 141.9, z: 2.2 },
    { x: 150.2, z: -1.8 },
    { x: 163.7, z: -9.9 },
    { x: 175.0, z: -17.1 },
    { x: 182.2, z: -22.8 },
    { x: 188.7, z: -27.9 },
    { x: 193.6, z: -32.5 },
    { x: 199.5, z: -39.5 },
    { x: 206.0, z: -48.2 },
    { x: 211.9, z: -56.2 },
    { x: 218.3, z: -66.8 },
    { x: 224.2, z: -78.8 },
    { x: 229.5, z: -94.5 },
    { x: 232.2, z: -105.1 },
    { x: 232.8, z: -116.0 },
    { x: 232.6, z: -127.7 },
    { x: 231.7, z: -135.1 },
    { x: 227.9, z: -150.4 },
    { x: 221.5, z: -167.6 },
    { x: 216.8, z: -180.1 },
    { x: 213.4, z: -186.8 },
    { x: 206.7, z: -199.3 },
    { x: 203.3, z: -204.1 },
    { x: 193.3, z: -219.4 },
    { x: 188.6, z: -227.3 },
    { x: 183.1, z: -239.4 },
    { x: 177.6, z: -251.6 },
    { x: 173.1, z: -261.4 },
    { x: 160.9, z: -287.0 },
    { x: 142.5, z: -322.5 },
    { x: 125.9, z: -358.9 },
    { x: 111.7, z: -398.0 },
    { x: 96.2, z: -434.9 },
    { x: 88.1, z: -451.3 },
    { x: 80.1, z: -464.0 },
    { x: 74.8, z: -469.3 },
    { x: 66.5, z: -477.5 },
    { x: 55.3, z: -486.1 },
    { x: 43.4, z: -492.2 },
    { x: 31.1, z: -497.4 },
    { x: 17.4, z: -501.2 },
    { x: 1.8, z: -503.9 },
    { x: -14.8, z: -504.2 },
    { x: -28.1, z: -504.4 },
    { x: -44.7, z: -502.1 },
    { x: -59.3, z: -498.7 },
    { x: -83.8, z: -491.0 },
    { x: -100.3, z: -485.0 },
    { x: -123.7, z: -476.1 },
    { x: -146.2, z: -467.4 },
    { x: -175.0, z: -456.3 },
    { x: -211.8, z: -442.9 },
    { x: -221.2, z: -439.4 },
    { x: -243.8, z: -430.8 },
    { x: -253.4, z: -427.9 },
];

// Catmull-Rom spline interpolation for smooth curves (with Y coordinate)
function catmullRomSpline(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    // Use y=0 as default if not provided (for backwards compatibility)
    const y0 = p0.y || 0, y1 = p1.y || 0, y2 = p2.y || 0, y3 = p3.y || 0;
    return {
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * y1) + (-y0 + y2) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 + (-y0 + 3 * y1 - 3 * y2 + y3) * t3),
        z: 0.5 * ((2 * p1.z) + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3)
    };
}

// Generate smoothed waypoints using Catmull-Rom spline
function generateSmoothPath(rawPoints, subdivisions = 3) {
    const smoothed = [];
    const n = rawPoints.length;

    for (let i = 0; i < n; i++) {
        const p0 = rawPoints[(i - 1 + n) % n];
        const p1 = rawPoints[i];
        const p2 = rawPoints[(i + 1) % n];
        const p3 = rawPoints[(i + 2) % n];

        for (let j = 0; j < subdivisions; j++) {
            const t = j / subdivisions;
            smoothed.push(catmullRomSpline(p0, p1, p2, p3, t));
        }
    }

    return smoothed;
}

// Generate the smoothed path
const CITY_WAYPOINTS = generateSmoothPath(CITY_WAYPOINTS_RAW, 4);

// Path mode - 'track' for oval track, 'city' for city streets, 'mountain_roads' for mountain roads
let currentPathMode = 'track';

// ============================================
// MOUNTAIN ROADS PATH SYSTEM
// ============================================

// Mountain roads waypoints - traced using path editor (with Y for elevation)
const MOUNTAIN_ROADS_WAYPOINTS_RAW = [
    { x: -598.1, y: 88.0, z: 928.6 },
    { x: -602.6, y: 88.0, z: 922.5 },
    { x: -605.4, y: 88.0, z: 918.5 },
    { x: -609.0, y: 88.0, z: 913.9 },
    { x: -614.6, y: 88.0, z: 907.9 },
    { x: -621.6, y: 88.0, z: 900.9 },
    { x: -627.0, y: 88.0, z: 895.3 },
    { x: -630.9, y: 88.0, z: 890.7 },
    { x: -637.4, y: 88.0, z: 881.4 },
    { x: -645.2, y: 88.0, z: 870.3 },
    { x: -652.7, y: 88.0, z: 859.2 },
    { x: -660.7, y: 88.0, z: 844.7 },
    { x: -665.3, y: 88.0, z: 827.9 },
    { x: -666.7, y: 88.0, z: 812.1 },
    { x: -664.6, y: 88.0, z: 795.6 },
    { x: -661.6, y: 88.0, z: 786.7 },
    { x: -655.4, y: 88.0, z: 772.3 },
    { x: -649.0, y: 80.9, z: 758.7 },
    { x: -641.3, y: 80.9, z: 739.3 },
    { x: -641.3, y: 79.4, z: 725.1 },
    { x: -644.3, y: 76.9, z: 710.6 },
    { x: -650.0, y: 73.8, z: 701.4 },
    { x: -657.5, y: 70.9, z: 695.1 },
    { x: -671.3, y: 68.4, z: 690.1 },
    { x: -682.8, y: 65.0, z: 689.6 },
    { x: -694.6, y: 62.5, z: 692.5 },
    { x: -706.8, y: 62.5, z: 699.7 },
    { x: -719.8, y: 62.5, z: 710.7 },
    { x: -726.8, y: 61.3, z: 717.6 },
    { x: -736.9, y: 61.3, z: 728.4 },
    { x: -747.0, y: 60.0, z: 739.5 },
    { x: -757.8, y: 60.0, z: 751.3 },
    { x: -766.5, y: 60.0, z: 760.6 },
    { x: -774.1, y: 60.0, z: 768.9 },
    { x: -781.8, y: 60.0, z: 777.5 },
    { x: -794.0, y: 60.0, z: 790.0 },
    { x: -803.9, y: 60.0, z: 799.5 },
    { x: -817.9, y: 59.7, z: 810.3 },
    { x: -829.7, y: 59.7, z: 814.2 },
    { x: -836.1, y: 59.7, z: 814.3 },
    { x: -842.8, y: 56.5, z: 812.0 },
    { x: -851.2, y: 56.5, z: 805.8 },
    { x: -855.7, y: 52.4, z: 796.3 },
    { x: -854.5, y: 49.2, z: 787.6 },
    { x: -848.2, y: 45.6, z: 778.9 },
    { x: -839.5, y: 45.6, z: 772.5 },
    { x: -833.6, y: 45.6, z: 768.7 },
    { x: -821.8, y: 44.1, z: 762.5 },
    { x: -813.9, y: 44.1, z: 758.3 },
    { x: -800.8, y: 44.1, z: 752.2 },
    { x: -784.1, y: 44.1, z: 744.5 },
    { x: -770.1, y: 44.1, z: 736.9 },
    { x: -756.8, y: 44.1, z: 726.8 },
    { x: -747.3, y: 44.1, z: 715.1 },
    { x: -742.5, y: 44.1, z: 703.3 },
    { x: -741.2, y: 42.3, z: 686.3 },
    { x: -750.3, y: 38.0, z: 664.7 },
    { x: -757.5, y: 38.0, z: 656.4 },
    { x: -771.9, y: 33.2, z: 646.4 },
    { x: -795.4, y: 29.7, z: 642.4 },
    { x: -817.4, y: 27.5, z: 650.7 },
    { x: -833.5, y: 26.0, z: 674.4 },
    { x: -844.5, y: 25.0, z: 698.2 },
    { x: -851.0, y: 23.3, z: 712.3 },
    { x: -859.4, y: 23.3, z: 718.3 },
    { x: -869.0, y: 21.8, z: 720.6 },
    { x: -878.4, y: 20.0, z: 719.8 },
    { x: -887.0, y: 18.6, z: 715.9 },
    { x: -893.1, y: 17.3, z: 707.8 },
    { x: -899.3, y: 15.8, z: 692.1 },
    { x: -903.6, y: 13.5, z: 680.7 },
    { x: -906.7, y: 13.5, z: 672.5 },
    { x: -909.9, y: 12.3, z: 663.8 },
    { x: -912.5, y: 12.3, z: 654.7 },
    { x: -913.7, y: 12.3, z: 648.3 },
    { x: -916.7, y: 12.3, z: 633.1 },
    { x: -920.8, y: 12.3, z: 611.0 },
    { x: -925.5, y: 12.3, z: 585.6 },
    { x: -924.8, y: 12.3, z: 580.2 },
    { x: -923.4, y: 12.3, z: 575.4 },
    { x: -923.4, y: 12.3, z: 566.5 },
    { x: -924.9, y: 12.3, z: 556.6 },
    { x: -925.6, y: 12.3, z: 548.1 },
    { x: -925.1, y: 11.0, z: 532.9 },
    { x: -921.4, y: 13.0, z: 510.1 },
    { x: -917.6, y: 15.1, z: 492.2 },
    { x: -914.6, y: 18.3, z: 477.7 },
    { x: -912.5, y: 20.6, z: 466.2 },
    { x: -910.6, y: 20.0, z: 453.8 },
    { x: -909.2, y: 20.0, z: 444.4 },
    { x: -907.8, y: 21.1, z: 436.5 },
    { x: -905.4, y: 22.3, z: 424.7 },
    { x: -902.5, y: 23.1, z: 409.2 },
    { x: -899.3, y: 24.3, z: 395.6 },
    { x: -897.2, y: 24.3, z: 385.3 },
    { x: -895.8, y: 24.3, z: 378.7 },
    { x: -893.4, y: 24.3, z: 366.2 },
    { x: -892.6, y: 24.3, z: 359.5 },
    { x: -893.1, y: 24.3, z: 352.1 },
    { x: -896.6, y: 24.3, z: 340.7 },
    { x: -899.9, y: 24.3, z: 333.7 },
    { x: -902.3, y: 24.3, z: 328.7 },
    { x: -905.6, y: 24.3, z: 323.1 },
    { x: -909.4, y: 24.3, z: 317.5 },
    { x: -912.0, y: 23.1, z: 314.5 },
    { x: -923.3, y: 21.6, z: 302.8 },
    { x: -929.9, y: 21.6, z: 297.6 },
    { x: -937.2, y: 21.6, z: 291.4 },
    { x: -948.8, y: 21.6, z: 279.8 },
    { x: -954.7, y: 20.1, z: 270.9 },
    { x: -959.7, y: 20.1, z: 261.6 },
    { x: -965.0, y: 18.8, z: 250.6 },
    { x: -969.7, y: 20.1, z: 231.0 },
    { x: -971.7, y: 20.1, z: 214.9 },
    { x: -972.0, y: 20.1, z: 200.4 },
    { x: -970.8, y: 20.1, z: 188.0 },
    { x: -967.7, y: 20.1, z: 171.0 },
    { x: -966.3, y: 20.1, z: 164.7 },
    { x: -963.6, y: 20.1, z: 157.7 },
    { x: -959.0, y: 20.1, z: 151.5 },
    { x: -955.9, y: 20.1, z: 147.6 },
    { x: -951.5, y: 20.1, z: 143.1 },
    { x: -946.2, y: 20.1, z: 138.2 },
    { x: -941.7, y: 20.1, z: 135.0 },
    { x: -938.7, y: 20.1, z: 132.8 },
    { x: -932.8, y: 20.1, z: 129.0 },
    { x: -926.7, y: 20.1, z: 125.6 },
    { x: -922.3, y: 20.1, z: 123.2 },
    { x: -917.5, y: 20.1, z: 120.7 },
    { x: -912.4, y: 20.1, z: 118.0 },
    { x: -908.8, y: 20.1, z: 116.1 },
    { x: -901.3, y: 20.1, z: 112.0 },
    { x: -899.1, y: 20.1, z: 108.7 },
    { x: -896.2, y: 20.1, z: 104.6 },
    { x: -893.3, y: 20.1, z: 100.2 },
    { x: -890.3, y: 20.1, z: 95.9 },
    { x: -888.3, y: 20.1, z: 92.9 },
    { x: -886.2, y: 20.1, z: 90.8 },
    { x: -883.4, y: 20.1, z: 87.6 },
    { x: -881.6, y: 20.1, z: 85.6 },
    { x: -880.1, y: 20.1, z: 83.9 },
    { x: -877.6, y: 20.1, z: 81.0 },
    { x: -875.8, y: 20.1, z: 79.0 },
    { x: -874.7, y: 20.1, z: 78.0 },
    { x: -871.3, y: 20.1, z: 74.6 },
    { x: -867.4, y: 20.1, z: 70.8 },
    { x: -863.1, y: 20.1, z: 66.9 },
    { x: -860.7, y: 20.1, z: 64.8 },
    { x: -856.4, y: 20.1, z: 61.4 },
    { x: -851.5, y: 20.1, z: 57.5 },
    { x: -846.6, y: 20.1, z: 53.6 },
    { x: -842.5, y: 20.1, z: 50.3 },
    { x: -838.4, y: 20.1, z: 47.0 },
    { x: -835.9, y: 20.1, z: 45.0 },
    { x: -831.7, y: 20.1, z: 40.3 },
    { x: -829.5, y: 20.1, z: 38.0 },
    { x: -827.3, y: 20.1, z: 35.6 },
    { x: -825.5, y: 21.6, z: 33.8 },
    { x: -821.5, y: 23.1, z: 29.4 },
    { x: -818.5, y: 25.6, z: 24.7 },
    { x: -817.8, y: 25.6, z: 21.8 },
    { x: -818.4, y: 25.6, z: 12.5 },
    { x: -823.0, y: 25.6, z: 9.0 },
    { x: -832.1, y: 25.6, z: 8.0 },
    { x: -834.7, y: 23.8, z: 9.6 },
    { x: -836.8, y: 22.3, z: 10.9 },
    { x: -842.2, y: 20.1, z: 14.4 },
    { x: -842.6, y: 20.1, z: 11.7 },
    { x: -842.5, y: 20.1, z: 9.7 },
    { x: -841.6, y: 20.1, z: 6.6 },
    { x: -836.9, y: 20.1, z: 1.2 },
    { x: -833.3, y: 20.1, z: -1.6 },
    { x: -828.2, y: 20.1, z: -4.7 },
    { x: -822.5, y: 20.1, z: -5.6 },
    { x: -819.0, y: 20.1, z: -5.8 },
    { x: -814.3, y: 20.1, z: -6.0 },
    { x: -811.3, y: 20.1, z: -6.0 },
    { x: -808.0, y: 20.1, z: -6.1 },
    { x: -804.3, y: 20.1, z: -6.3 },
    { x: -799.1, y: 20.1, z: -6.4 },
    { x: -794.3, y: 20.1, z: -6.5 },
    { x: -788.0, y: 20.1, z: -6.6 },
    { x: -782.1, y: 20.1, z: -6.9 },
    { x: -776.9, y: 20.1, z: -7.5 },
    { x: -772.2, y: 20.1, z: -9.5 },
    { x: -769.3, y: 20.1, z: -11.5 },
    { x: -766.1, y: 20.1, z: -13.8 },
    { x: -761.6, y: 20.1, z: -17.0 },
    { x: -756.9, y: 20.1, z: -20.3 },
    { x: -752.6, y: 20.1, z: -22.8 },
    { x: -745.8, y: 20.1, z: -24.4 },
    { x: -739.4, y: 20.1, z: -26.0 },
    { x: -728.0, y: 20.1, z: -28.7 },
    { x: -717.3, y: 20.1, z: -31.9 },
    { x: -705.7, y: 20.1, z: -37.1 },
    { x: -691.7, y: 19.1, z: -46.7 },
    { x: -683.3, y: 19.1, z: -55.5 },
    { x: -675.5, y: 18.1, z: -71.4 },
    { x: -672.0, y: 16.3, z: -88.1 },
    { x: -671.8, y: 15.8, z: -99.9 },
    { x: -671.8, y: 14.3, z: -108.1 },
    { x: -672.9, y: 14.3, z: -118.8 },
    { x: -673.2, y: 14.3, z: -126.9 },
    { x: -672.6, y: 14.3, z: -131.7 },
    { x: -671.8, y: 14.3, z: -133.5 },
    { x: -670.9, y: 14.3, z: -135.8 },
    { x: -670.3, y: 14.3, z: -145.2 },
    { x: -669.6, y: 14.3, z: -149.9 },
    { x: -670.0, y: 12.8, z: -156.7 },
    { x: -668.9, y: 12.8, z: -166.1 },
    { x: -667.9, y: 12.8, z: -173.0 },
    { x: -665.9, y: 12.8, z: -185.1 },
    { x: -664.7, y: 12.8, z: -190.5 },
    { x: -663.4, y: 12.8, z: -196.8 },
    { x: -662.0, y: 12.8, z: -205.0 },
    { x: -660.3, y: 12.8, z: -214.3 },
    { x: -658.5, y: 12.8, z: -225.2 },
    { x: -656.0, y: 12.8, z: -246.8 },
    { x: -655.0, y: 12.8, z: -256.2 },
    { x: -653.6, y: 12.8, z: -266.6 },
    { x: -652.8, y: 12.8, z: -277.1 },
    { x: -652.9, y: 12.8, z: -288.8 },
    { x: -653.3, y: 12.8, z: -299.8 },
    { x: -653.9, y: 12.8, z: -312.3 },
    { x: -654.3, y: 12.8, z: -322.8 },
    { x: -654.4, y: 12.8, z: -331.4 },
    { x: -654.1, y: 12.8, z: -338.4 },
    { x: -654.4, y: 12.8, z: -348.6 },
    { x: -654.6, y: 12.8, z: -359.3 },
    { x: -654.4, y: 12.8, z: -374.8 },
    { x: -651.9, y: 12.8, z: -386.0 },
    { x: -647.9, y: 12.8, z: -393.1 },
    { x: -642.3, y: 12.8, z: -397.9 },
    { x: -634.8, y: 12.8, z: -400.1 },
    { x: -629.6, y: 12.8, z: -399.5 },
    { x: -621.7, y: 12.8, z: -399.0 },
    { x: -615.2, y: 12.8, z: -398.5 },
    { x: -610.3, y: 12.8, z: -397.5 },
    { x: -606.0, y: 12.8, z: -396.1 },
    { x: -598.8, y: 12.8, z: -393.4 },
    { x: -593.9, y: 12.8, z: -392.4 },
    { x: -591.0, y: 12.8, z: -391.9 },
    { x: -583.8, y: 12.8, z: -391.5 },
    { x: -575.0, y: 12.8, z: -391.0 },
    { x: -567.4, y: 12.8, z: -390.7 },
    { x: -559.7, y: 12.8, z: -390.6 },
    { x: -542.5, y: 12.8, z: -390.2 },
    { x: -530.5, y: 12.8, z: -389.8 },
    { x: -516.4, y: 12.8, z: -388.0 },
    { x: -500.0, y: 12.8, z: -385.9 },
    { x: -485.1, y: 12.8, z: -383.8 },
    { x: -466.1, y: 12.8, z: -379.6 },
    { x: -449.7, y: 11.8, z: -375.2 },
    { x: -444.9, y: 12.4, z: -373.6 },
    { x: -437.6, y: 12.4, z: -371.1 },
    { x: -425.0, y: 12.2, z: -366.3 },
    { x: -417.3, y: 12.4, z: -362.7 },
    { x: -404.4, y: 13.7, z: -356.6 },
    { x: -398.0, y: 13.7, z: -353.1 },
    { x: -389.4, y: 14.7, z: -346.4 },
    { x: -374.4, y: 16.7, z: -333.2 },
    { x: -365.3, y: 17.7, z: -324.3 },
    { x: -355.3, y: 19.4, z: -315.9 },
    { x: -344.7, y: 21.0, z: -309.7 },
    { x: -333.6, y: 22.4, z: -303.2 },
    { x: -315.3, y: 24.4, z: -293.3 },
    { x: -297.1, y: 26.4, z: -284.1 },
    { x: -277.3, y: 28.7, z: -274.4 },
    { x: -259.8, y: 31.5, z: -268.8 },
    { x: -233.6, y: 36.0, z: -276.7 },
    { x: -220.3, y: 36.8, z: -296.4 },
    { x: -218.6, y: 37.3, z: -312.2 },
    { x: -224.3, y: 39.0, z: -354.5 },
    { x: -215.8, y: 41.3, z: -374.3 },
    { x: -196.9, y: 44.0, z: -385.1 },
    { x: -181.0, y: 46.8, z: -384.2 },
    { x: -167.2, y: 50.5, z: -378.8 },
    { x: -156.1, y: 53.0, z: -368.2 },
    { x: -152.5, y: 55.3, z: -355.4 },
    { x: -155.3, y: 56.8, z: -333.8 },
    { x: -165.9, y: 56.8, z: -316.4 },
    { x: -175.0, y: 57.4, z: -302.8 },
    { x: -186.6, y: 57.3, z: -286.7 },
    { x: -203.9, y: 57.8, z: -262.6 },
    { x: -215.2, y: 61.0, z: -233.9 },
    { x: -213.2, y: 63.3, z: -224.9 },
    { x: -206.7, y: 65.0, z: -214.9 },
    { x: -198.7, y: 67.3, z: -208.0 },
    { x: -188.7, y: 69.3, z: -204.3 },
    { x: -171.5, y: 70.2, z: -204.7 },
    { x: -154.1, y: 71.5, z: -213.5 },
    { x: -140.2, y: 73.0, z: -234.9 },
    { x: -135.9, y: 73.5, z: -252.3 },
    { x: -132.3, y: 73.2, z: -269.2 },
    { x: -126.2, y: 74.0, z: -290.8 },
    { x: -118.4, y: 73.6, z: -317.2 },
    { x: -108.8, y: 74.9, z: -344.0 },
    { x: -98.7, y: 76.2, z: -359.8 },
    { x: -88.5, y: 77.4, z: -368.2 },
    { x: -77.7, y: 79.4, z: -372.5 },
    { x: -59.1, y: 86.6, z: -366.2 },
    { x: -51.2, y: 90.4, z: -348.9 },
    { x: -51.9, y: 92.9, z: -316.0 },
    { x: -55.5, y: 94.3, z: -287.9 },
    { x: -62.7, y: 92.4, z: -266.3 },
    { x: -74.0, y: 90.7, z: -246.3 },
    { x: -82.1, y: 88.6, z: -234.2 },
    { x: -100.6, y: 84.8, z: -208.8 },
    { x: -111.2, y: 84.6, z: -177.3 },
    { x: -112.3, y: 84.1, z: -146.2 },
    { x: -109.5, y: 84.1, z: -139.8 },
    { x: -108.1, y: 84.1, z: -132.8 },
    { x: -107.5, y: 84.1, z: -123.8 },
    { x: -106.6, y: 84.1, z: -110.2 },
    { x: -105.4, y: 84.1, z: -97.5 },
    { x: -103.9, y: 84.1, z: -83.6 },
    { x: -102.4, y: 84.1, z: -71.0 },
    { x: -100.2, y: 84.1, z: -54.6 },
    { x: -97.7, y: 84.1, z: -37.8 },
    { x: -94.9, y: 84.1, z: -20.0 },
    { x: -91.8, y: 84.1, z: -3.0 },
    { x: -88.3, y: 82.8, z: 13.2 },
    { x: -84.7, y: 82.8, z: 28.0 },
    { x: -81.0, y: 82.8, z: 42.0 },
    { x: -78.6, y: 81.6, z: 50.4 },
    { x: -74.3, y: 81.6, z: 65.6 },
    { x: -68.4, y: 81.6, z: 82.1 },
    { x: -62.2, y: 83.3, z: 105.7 },
    { x: -54.6, y: 86.6, z: 133.2 },
    { x: -51.6, y: 90.1, z: 144.8 },
    { x: -49.2, y: 92.4, z: 154.3 },
    { x: -46.5, y: 94.1, z: 164.7 },
    { x: -43.7, y: 95.4, z: 174.5 },
    { x: -39.5, y: 97.1, z: 189.4 },
    { x: -34.9, y: 98.6, z: 201.5 },
    { x: -26.9, y: 100.1, z: 217.1 },
    { x: -15.1, y: 102.1, z: 234.2 },
    { x: 6.6, y: 104.1, z: 253.2 },
    { x: 26.2, y: 105.8, z: 263.5 },
    { x: 39.2, y: 105.8, z: 266.8 },
    { x: 49.4, y: 107.6, z: 267.8 },
    { x: 60.8, y: 107.6, z: 271.6 },
    { x: 70.5, y: 107.6, z: 274.1 },
    { x: 79.4, y: 107.6, z: 276.4 },
    { x: 106.6, y: 109.1, z: 284.0 },
    { x: 127.4, y: 110.1, z: 283.5 },
    { x: 163.7, y: 111.9, z: 280.8 },
    { x: 197.3, y: 112.9, z: 289.2 },
    { x: 211.8, y: 112.9, z: 296.5 },
    { x: 225.9, y: 112.9, z: 309.0 },
    { x: 235.8, y: 112.9, z: 319.8 },
    { x: 243.3, y: 112.9, z: 332.2 },
    { x: 250.1, y: 112.9, z: 347.3 },
    { x: 255.1, y: 112.9, z: 363.0 },
    { x: 258.4, y: 112.9, z: 380.4 },
    { x: 259.9, y: 112.9, z: 397.2 },
    { x: 261.8, y: 112.9, z: 412.8 },
    { x: 259.6, y: 110.9, z: 432.1 },
    { x: 257.1, y: 109.1, z: 442.0 },
    { x: 250.9, y: 104.6, z: 467.0 },
    { x: 245.8, y: 102.9, z: 481.0 },
    { x: 239.1, y: 102.9, z: 503.2 },
    { x: 224.1, y: 102.4, z: 537.0 },
    { x: 219.2, y: 102.4, z: 559.4 },
    { x: 217.4, y: 104.1, z: 575.1 },
    { x: 322.9, y: 95.3, z: 818.2 },
    { x: 330.6, y: 95.3, z: 819.1 },
    { x: 342.9, y: 95.3, z: 819.8 },
    { x: 354.1, y: 95.3, z: 820.2 },
    { x: 375.8, y: 95.5, z: 822.1 },
    { x: 388.5, y: 97.3, z: 829.9 },
    { x: 406.2, y: 99.5, z: 848.2 },
    { x: 415.4, y: 99.5, z: 858.9 },
    { x: 424.2, y: 99.5, z: 868.7 },
    { x: 433.5, y: 99.5, z: 879.5 },
    { x: 447.4, y: 98.1, z: 898.5 },
    { x: 453.7, y: 98.1, z: 908.4 },
    { x: 459.2, y: 96.1, z: 917.9 },
    { x: 465.7, y: 94.4, z: 930.5 },
    { x: 471.2, y: 94.4, z: 942.6 },
    { x: 477.0, y: 93.2, z: 959.1 },
    { x: 481.2, y: 94.4, z: 977.9 },
    { x: 483.7, y: 96.4, z: 997.5 },
    { x: 484.6, y: 98.4, z: 1019.4 },
    { x: 484.2, y: 100.9, z: 1043.2 },
    { x: 482.1, y: 102.9, z: 1070.3 },
    { x: 479.0, y: 104.1, z: 1091.1 },
    { x: 475.1, y: 104.1, z: 1103.4 },
    { x: 468.8, y: 102.9, z: 1117.0 },
    { x: 463.9, y: 101.1, z: 1125.2 },
    { x: 456.5, y: 98.9, z: 1136.7 },
    { x: 447.4, y: 96.7, z: 1149.9 },
    { x: 441.8, y: 94.7, z: 1157.6 },
    { x: 430.9, y: 93.2, z: 1173.2 },
    { x: 420.5, y: 92.1, z: 1187.9 },
    { x: 415.2, y: 91.4, z: 1196.7 },
    { x: 409.1, y: 91.4, z: 1206.7 },
    { x: 402.8, y: 90.1, z: 1220.8 },
    { x: 399.4, y: 90.1, z: 1229.9 },
    { x: 383.5, y: 91.4, z: 1238.1 },
    { x: 372.4, y: 91.4, z: 1239.4 },
    { x: 359.9, y: 91.4, z: 1240.5 },
    { x: 315.7, y: 93.4, z: 1242.4 },
    { x: 302.0, y: 93.4, z: 1242.7 },
    { x: 281.5, y: 93.4, z: 1242.8 },
    { x: 265.2, y: 93.4, z: 1242.8 },
    { x: 242.5, y: 93.4, z: 1242.0 },
    { x: 215.8, y: 91.9, z: 1240.2 },
    { x: 200.7, y: 91.9, z: 1238.4 },
    { x: 185.8, y: 90.6, z: 1236.5 },
    { x: 171.1, y: 90.6, z: 1233.7 },
    { x: 158.3, y: 90.6, z: 1227.9 },
    { x: 152.2, y: 90.6, z: 1217.8 },
    { x: 143.3, y: 89.1, z: 1199.1 },
    { x: 136.7, y: 87.8, z: 1183.7 },
    { x: 130.6, y: 86.6, z: 1166.3 },
    { x: 124.8, y: 84.8, z: 1150.0 },
    { x: 119.1, y: 83.3, z: 1132.4 },
    { x: 111.4, y: 82.6, z: 1111.3 },
    { x: 104.9, y: 79.9, z: 1097.8 },
    { x: 95.9, y: 76.8, z: 1086.2 },
    { x: 86.7, y: 74.3, z: 1075.9 },
    { x: 78.2, y: 72.6, z: 1069.2 },
    { x: 70.2, y: 70.3, z: 1064.1 },
    { x: 63.5, y: 68.3, z: 1060.8 },
    { x: 55.6, y: 66.1, z: 1057.3 },
    { x: 43.7, y: 63.4, z: 1052.9 },
    { x: 34.0, y: 61.6, z: 1049.7 },
    { x: 23.5, y: 59.6, z: 1047.4 },
    { x: 13.1, y: 57.9, z: 1045.9 },
    { x: 4.4, y: 57.9, z: 1044.9 },
    { x: 0.6, y: 56.4, z: 1044.0 },
    { x: -4.6, y: 56.4, z: 1042.4 },
    { x: -11.6, y: 54.8, z: 1039.8 },
    { x: -23.4, y: 54.8, z: 1037.6 },
    { x: -40.7, y: 54.1, z: 1035.4 },
    { x: -50.6, y: 54.1, z: 1033.5 },
    { x: -59.1, y: 53.3, z: 1032.0 },
    { x: -69.7, y: 51.2, z: 1030.2 },
    { x: -80.7, y: 51.2, z: 1028.3 },
    { x: -94.0, y: 50.2, z: 1027.7 },
    { x: -108.5, y: 48.5, z: 1027.8 },
    { x: -120.6, y: 48.5, z: 1029.1 },
    { x: -136.3, y: 48.5, z: 1031.1 },
    { x: -163.9, y: 48.5, z: 1035.7 },
    { x: -192.3, y: 50.2, z: 1041.7 },
    { x: -207.1, y: 50.2, z: 1044.7 },
    { x: -223.7, y: 51.7, z: 1048.0 },
    { x: -236.3, y: 51.7, z: 1050.4 },
    { x: -254.3, y: 53.2, z: 1051.9 },
    { x: -268.3, y: 54.7, z: 1051.4 },
    { x: -277.8, y: 56.3, z: 1050.2 },
    { x: -288.1, y: 59.2, z: 1048.7 },
    { x: -299.2, y: 63.5, z: 1046.9 },
    { x: -307.6, y: 66.3, z: 1045.4 },
    { x: -316.2, y: 69.5, z: 1044.0 },
    { x: -329.1, y: 72.8, z: 1041.5 },
    { x: -337.2, y: 75.3, z: 1039.3 },
    { x: -345.1, y: 77.5, z: 1036.9 },
    { x: -358.7, y: 82.0, z: 1032.6 },
    { x: -373.8, y: 85.3, z: 1026.4 },
    { x: -390.2, y: 87.0, z: 1018.3 },
    { x: -419.1, y: 89.5, z: 1004.7 },
    { x: -432.7, y: 91.8, z: 997.3 },
    { x: -448.7, y: 93.8, z: 990.8 },
    { x: -465.0, y: 94.8, z: 986.7 },
    { x: -470.3, y: 94.8, z: 987.0 },
    { x: -476.0, y: 94.8, z: 989.9 },
    { x: -480.7, y: 94.8, z: 991.1 },
    { x: -488.2, y: 94.8, z: 989.2 },
    { x: -493.3, y: 95.8, z: 988.1 },
    { x: -505.9, y: 96.8, z: 985.9 },
    { x: -512.3, y: 95.8, z: 985.0 },
    { x: -523.2, y: 95.8, z: 983.1 },
    { x: -532.4, y: 94.3, z: 981.0 },
    { x: -546.6, y: 94.3, z: 976.2 },
    { x: -559.2, y: 92.5, z: 971.2 },
    { x: -572.5, y: 91.0, z: 963.8 },
    { x: -582.2, y: 89.6, z: 953.9 },
    { x: -589.2, y: 89.6, z: 943.8 },
    { x: -596.9, y: 88.2, z: 931.6 },
];

// Generate the smoothed mountain roads path
const MOUNTAIN_ROADS_WAYPOINTS = generateSmoothPath(MOUNTAIN_ROADS_WAYPOINTS_RAW, 4);

// Ground heights calculated by raycasting (set by main.js after model loads)
let mountainRoadsGroundHeights = null;

// Export waypoints for ground height calculation
export function getMountainRoadsWaypoints() {
    return MOUNTAIN_ROADS_WAYPOINTS;
}

// Set ground heights (called from main.js after raycasting)
export function setMountainRoadsGroundHeights(heights) {
    mountainRoadsGroundHeights = heights;
    console.log(`Ground heights set for ${heights.length} waypoints`);
}

// Pre-calculate mountain roads segment lengths and smoothed rotations
let mountainRoadsSegmentLengths = [];
let mountainRoadsTotalLength = 0;
let mountainRoadsSmoothedRotations = [];

function calculateMountainRoadsPathLengths() {
    mountainRoadsSegmentLengths = [];
    mountainRoadsTotalLength = 0;

    for (let i = 0; i < MOUNTAIN_ROADS_WAYPOINTS.length; i++) {
        const p1 = MOUNTAIN_ROADS_WAYPOINTS[i];
        const p2 = MOUNTAIN_ROADS_WAYPOINTS[(i + 1) % MOUNTAIN_ROADS_WAYPOINTS.length];
        const dx = p2.x - p1.x;
        const dy = (p2.y || 0) - (p1.y || 0);
        const dz = p2.z - p1.z;
        // Include Y in distance calculation for proper path length on slopes
        const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
        mountainRoadsSegmentLengths.push(length);
        mountainRoadsTotalLength += length;
    }

    // Pre-calculate smoothed rotations for each waypoint
    // Use a large window to get very smooth direction changes
    const lookAheadPoints = 30;
    mountainRoadsSmoothedRotations = [];

    for (let i = 0; i < MOUNTAIN_ROADS_WAYPOINTS.length; i++) {
        let avgDx = 0, avgDz = 0;
        for (let j = 0; j < lookAheadPoints; j++) {
            const idx1 = (i + j) % MOUNTAIN_ROADS_WAYPOINTS.length;
            const idx2 = (i + j + 1) % MOUNTAIN_ROADS_WAYPOINTS.length;
            const pa = MOUNTAIN_ROADS_WAYPOINTS[idx1];
            const pb = MOUNTAIN_ROADS_WAYPOINTS[idx2];
            // Weight closer points more heavily for responsiveness
            const weight = 1 - (j / lookAheadPoints) * 0.5;
            avgDx += (pb.x - pa.x) * weight;
            avgDz += (pb.z - pa.z) * weight;
        }
        mountainRoadsSmoothedRotations.push(Math.atan2(avgDx, avgDz));
    }
}
calculateMountainRoadsPathLengths();

// Get mountain roads path length
export function getMountainRoadsPathLength() {
    return mountainRoadsTotalLength;
}

// Helper to interpolate angles correctly (handles wraparound)
function lerpAngle(a, b, t) {
    let diff = b - a;
    // Normalize to -PI to PI
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
}

// Get position on mountain roads given distance and lane offset
export function getMountainRoadsPosition(distance, lane = 1) {
    distance = distance % mountainRoadsTotalLength;
    if (distance < 0) distance += mountainRoadsTotalLength;

    // Find which segment we're on
    let accumulated = 0;
    for (let i = 0; i < MOUNTAIN_ROADS_WAYPOINTS.length; i++) {
        const segLength = mountainRoadsSegmentLengths[i];
        if (accumulated + segLength > distance) {
            const p1 = MOUNTAIN_ROADS_WAYPOINTS[i];
            const p2 = MOUNTAIN_ROADS_WAYPOINTS[(i + 1) % MOUNTAIN_ROADS_WAYPOINTS.length];
            const t = (distance - accumulated) / segLength;

            // Interpolate position
            const x = p1.x + (p2.x - p1.x) * t;
            const z = p1.z + (p2.z - p1.z) * t;

            // Use ground heights if available, otherwise fall back to path Y
            let y;
            if (mountainRoadsGroundHeights && mountainRoadsGroundHeights[i] !== null) {
                const i2 = (i + 1) % MOUNTAIN_ROADS_WAYPOINTS.length;
                const g1 = mountainRoadsGroundHeights[i];
                const g2 = mountainRoadsGroundHeights[i2] !== null ? mountainRoadsGroundHeights[i2] : g1;
                y = g1 + (g2 - g1) * t;
            } else {
                y = (p1.y || 0) + ((p2.y || 0) - (p1.y || 0)) * t;
            }

            // Use pre-calculated smoothed rotations and interpolate between them
            const i2 = (i + 1) % MOUNTAIN_ROADS_WAYPOINTS.length;
            const rot1 = mountainRoadsSmoothedRotations[i];
            const rot2 = mountainRoadsSmoothedRotations[i2];
            const rotation = lerpAngle(rot1, rot2, t);

            // Apply lane offset (perpendicular to direction)
            const laneOffset = (lane - 1) * 1.5;
            const perpX = Math.cos(rotation) * laneOffset;
            const perpZ = -Math.sin(rotation) * laneOffset;

            return {
                x: x + perpX,
                y: y,
                z: z + perpZ,
                rotation: rotation
            };
        }
        accumulated += segLength;
    }

    // Fallback to first point
    const p = MOUNTAIN_ROADS_WAYPOINTS[0];
    const fallbackY = mountainRoadsGroundHeights && mountainRoadsGroundHeights[0] !== null
        ? mountainRoadsGroundHeights[0]
        : (p.y || 0);
    return { x: p.x, y: fallbackY, z: p.z, rotation: mountainRoadsSmoothedRotations[0] || 0 };
}

// Pre-calculate segment lengths and total path length
let citySegmentLengths = [];
let cityTotalLength = 0;

function calculateCityPathLengths() {
    citySegmentLengths = [];
    cityTotalLength = 0;

    for (let i = 0; i < CITY_WAYPOINTS.length; i++) {
        const p1 = CITY_WAYPOINTS[i];
        const p2 = CITY_WAYPOINTS[(i + 1) % CITY_WAYPOINTS.length];
        const dx = p2.x - p1.x;
        const dz = p2.z - p1.z;
        const length = Math.sqrt(dx * dx + dz * dz);
        citySegmentLengths.push(length);
        cityTotalLength += length;
    }
}
calculateCityPathLengths();

export function setPathMode(mode) {
    currentPathMode = mode;
}

export function getPathMode() {
    return currentPathMode;
}

// Calculate total city path length
export function getCityPathLength() {
    return cityTotalLength;
}

// Get current path length based on mode
export function getCurrentPathLength(lane = 1) {
    if (currentPathMode === 'city') {
        return getCityPathLength();
    }
    if (currentPathMode === 'mountain_roads') {
        return getMountainRoadsPathLength();
    }
    return getTrackLength(lane);
}

// Get position on city streets given distance and lane offset
export function getCityStreetPosition(distance, lane = 1) {
    distance = distance % cityTotalLength;
    if (distance < 0) distance += cityTotalLength;

    // Find which segment we're on
    let accumulated = 0;
    for (let i = 0; i < CITY_WAYPOINTS.length; i++) {
        const segLength = citySegmentLengths[i];
        if (accumulated + segLength > distance) {
            // We're on this segment
            const p1 = CITY_WAYPOINTS[i];
            const p2 = CITY_WAYPOINTS[(i + 1) % CITY_WAYPOINTS.length];
            const t = (distance - accumulated) / segLength;

            // Interpolate position (including Y)
            const x = p1.x + (p2.x - p1.x) * t;
            const y = (p1.y || 0) + ((p2.y || 0) - (p1.y || 0)) * t;
            const z = p1.z + (p2.z - p1.z) * t;

            // Calculate rotation (facing direction of travel)
            const rotation = Math.atan2(p2.x - p1.x, p2.z - p1.z);

            // Apply lane offset (perpendicular to direction)
            const laneOffset = (lane - 1) * 1.5;
            const perpX = Math.cos(rotation) * laneOffset;
            const perpZ = -Math.sin(rotation) * laneOffset;

            return {
                x: x + perpX,
                y: y,
                z: z + perpZ,
                rotation: rotation
            };
        }
        accumulated += segLength;
    }

    // Fallback to first point
    return { x: CITY_WAYPOINTS[0].x, y: CITY_WAYPOINTS[0].y || 0, z: CITY_WAYPOINTS[0].z, rotation: 0 };
}

// Unified position getter - returns position based on current path mode
export function getPosition(distance, lane = 1) {
    if (currentPathMode === 'city') {
        return getCityStreetPosition(distance, lane);
    }
    if (currentPathMode === 'mountain_roads') {
        return getMountainRoadsPosition(distance, lane);
    }
    return getTrackPosition(distance, lane);
}

// Build the complete track and add to scene
export function buildTrack(scene) {
    // Track surface
    const trackMaterial = new THREE.MeshStandardMaterial({
        map: createTrackTexture(),
        normalMap: createTrackNormalMap(),
        normalScale: new THREE.Vector2(0.3, 0.3),
        roughness: 0.8,
        metalness: 0.0,
        color: 0x1a1a1a
    });

    const track = new THREE.Mesh(createTrackGeometry(), trackMaterial);
    track.receiveShadow = true;
    track.position.y = 0.01;
    scene.add(track);
    trackObjects.push(track);

    // Lane markings
    const markings = createLaneMarkings(scene);
    scene.add(markings);
    trackObjects.push(markings);

    // Infield
    const infield = createInfield();
    scene.add(infield);
    trackObjects.push(infield);

    // Outer ground
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(500, 500),
        new THREE.MeshStandardMaterial({ color: 0x3d5c3d, roughness: 0.9 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    scene.add(ground);
    trackObjects.push(ground);
}
