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

    // Lane markings
    scene.add(createLaneMarkings(scene));

    // Infield
    scene.add(createInfield());

    // Outer ground
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(500, 500),
        new THREE.MeshStandardMaterial({ color: 0x3d5c3d, roughness: 0.9 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    scene.add(ground);
}
