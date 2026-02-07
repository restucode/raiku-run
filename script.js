/**
 * RAIKU RUN - MOBILE PERFORMANCE OPTIMIZED
 * Features: Object Pooling, Shared Geometries, Delta Time Movement
 */

const CONFIG = {
    laneWidth: 3.5,
    maxScore: 300,
    redirect: "https://x.com/raikuorg"
};

const THEMES = [
    { score: 0, color: 0xc0fe38 },
    { score: 50, color: 0x00f3ff },
    { score: 100, color: 0xbc13fe },
    { score: 150, color: 0xffb702 }
];

let currentThemeColor = new THREE.Color(THEMES[0].color);

const OBSTACLE_FILES = [
    '1.png', '2.png', '3.png', '4.png', '5.png', '6.png', 
    '7.png', '8.png', '9.png', '10.png', '11.png', '12.png', 
    '13.png', '14.png', '15.png', '16.png', '17.png'
];

let isMuted = false;

// --- AUDIO SETUP ---
const audioIntro = new Audio('sfx/firstmusic.mp3');
audioIntro.loop = true; audioIntro.volume = 0.5;
const audioRun = new Audio('sfx/run.mp3');
audioRun.loop = true; audioRun.volume = 0.5;
const audioCrash = new Audio('sfx/gameover.mp3');
audioCrash.volume = 0.8;
const audioTeleport = new Audio('sfx/teleport.mp3');
audioTeleport.volume = 1.0;
const audioNoAirdrop = new Audio('sfx/noairdrop.mp3');
audioNoAirdrop.volume = 1.0;
const audioCoin = new Audio('sfx/coin.mp3');
audioCoin.volume = 0.6;

function toggleMute() {
    isMuted = !isMuted;
    document.getElementById('mute-btn').innerHTML = isMuted ? "🔇" : "🔊";
    const allAudios = [audioIntro, audioRun, audioCrash, audioTeleport, audioNoAirdrop, audioCoin];
    allAudios.forEach(a => a.muted = isMuted);
    if (!isMuted && !isGameActive && audioIntro.paused) audioIntro.play();
}

// --- GLOBAL VARIABLES ---
let scene, camera, renderer, clock;
let player, shadowMesh, floorMesh, dirLight;
// Active objects lists
let obstacles = [], coins = [], scenery = [], speedLines = [], particles = [];
// Pools (Recycled objects)
let obstaclePool = [], coinPool = [], sceneryPool = [], particlePool = [];
// Resources
let obstacleMaterials = []; // Pre-created materials
let loadedObstacleTextures = [];
let sharedObstacleGeo, sharedCoinGeo, sharedInnerCoinGeo, sharedSceneryGeo;
let sharedCoinMat, sharedInnerCoinMat, sharedSceneryMat;

let score = 0;
let isGameActive = false;
let isGameOver = false;
let isWon = false;
let currentLane = 0;
let gameSpeed = 35; // Speed in units per second
let highScore = localStorage.getItem('raikuHighScore') || 0;
let shakeIntensity = 0;
let laneDeck = [];

function shuffleDeck() {
    laneDeck = [-1, 0, 1];
    for (let i = laneDeck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [laneDeck[i], laneDeck[j]] = [laneDeck[j], laneDeck[i]];
    }
}

function init() {
    clock = new THREE.Clock();

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.03);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 5, 9);
    camera.lookAt(0, 1, -10);

    // PERFORMANCE: Limit pixel ratio for mobile to avoid lag
    const pixelRatio = Math.min(window.devicePixelRatio, 2);
    // Disable antialias on high-res screens to save GPU
    const useAntialias = pixelRatio < 2;

    renderer = new THREE.WebGLRenderer({ 
        antialias: useAntialias, 
        alpha: true, 
        powerPreference: "high-performance",
        precision: "mediump" // Sufficient for mobile
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(pixelRatio);
    document.body.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambient);

    dirLight = new THREE.DirectionalLight(currentThemeColor, 0.8);
    dirLight.position.set(0, 10, 5);
    scene.add(dirLight);

    // Floor
    const gridCanvas = document.createElement('canvas');
    gridCanvas.width = 64; gridCanvas.height = 64;
    const ctx = gridCanvas.getContext('2d');
    ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.strokeRect(0, 0, 64, 64);
    
    const gridTexture = new THREE.CanvasTexture(gridCanvas);
    gridTexture.wrapS = THREE.RepeatWrapping;
    gridTexture.wrapT = THREE.RepeatWrapping;
    gridTexture.repeat.set(20, 20);

    const floorGeo = new THREE.PlaneGeometry(200, 200);
    const floorMat = new THREE.MeshBasicMaterial({ map: gridTexture, color: currentThemeColor });
    floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    scene.add(floorMesh);

    // Initialize Shared Resources (Optimization)
    initSharedResources();

    createPlayer();
    createSpeedLines();
    shuffleDeck();

    document.addEventListener('keydown', onKeyDown);
    setupTouch();
    window.addEventListener('resize', onResize);

    document.getElementById('max-score').innerText = CONFIG.maxScore;
    document.getElementById('high-score').innerText = "BEST: " + highScore;
    updateThemeColor();

    // Interaction to unlock audio
    const unlockAudio = () => {
        if(!isGameActive && !isMuted) audioIntro.play().catch(()=>{});
        document.removeEventListener('click', unlockAudio);
        document.removeEventListener('touchstart', unlockAudio);
    };
    document.addEventListener('click', unlockAudio);
    document.addEventListener('touchstart', unlockAudio);

    animate();
}

// --- OPTIMIZATION: PRE-ALLOCATE MEMORY ---
function initSharedResources() {
    // 1. Geometries
    sharedObstacleGeo = new THREE.PlaneGeometry(2, 2);
    sharedCoinGeo = new THREE.OctahedronGeometry(0.5);
    sharedInnerCoinGeo = new THREE.OctahedronGeometry(0.4);
    sharedSceneryGeo = new THREE.BoxGeometry(2, 1, 2); // Height will be scaled

    // 2. Static Materials
    sharedCoinMat = new THREE.MeshBasicMaterial({ color: 0xffeb3b, wireframe: true });
    sharedInnerCoinMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
    sharedSceneryMat = new THREE.LineBasicMaterial({ color: 0xffffff });

    // 3. Load Obstacle Textures & Create Materials immediately
    const loader = new THREE.TextureLoader();
    let loadedCount = 0;
    OBSTACLE_FILES.forEach(filename => {
        loader.load('assets/' + filename, (tex) => {
            tex.minFilter = THREE.LinearFilter;
            tex.generateMipmaps = false; // Save memory
            loadedObstacleTextures.push(tex);
            
            // Create a material for this texture and store it
            const mat = new THREE.MeshBasicMaterial({ 
                map: tex, 
                transparent: true, 
                side: THREE.DoubleSide, 
                alphaTest: 0.1 
            });
            obstacleMaterials.push(mat);
            loadedCount++;
        });
    });
}

// --- POOLING SYSTEM ---
function getFromPool(pool, createFn) {
    if (pool.length > 0) {
        const obj = pool.pop();
        obj.visible = true;
        return obj;
    }
    return createFn();
}

function returnToPool(obj, pool, list) {
    obj.visible = false;
    pool.push(obj);
    // Remove from active list
    const index = list.indexOf(obj);
    if (index > -1) list.splice(index, 1);
}

// --- GAME LOGIC ---

window.initiateGame = function() {
    audioIntro.pause();
    document.getElementById('start-screen').style.display = 'none';
    const countdownEl = document.getElementById('countdown');
    countdownEl.style.display = 'block';
    let count = 3;
    const interval = setInterval(() => {
        count--;
        if (count > 0) countdownEl.innerText = count;
        else if (count === 0) countdownEl.innerText = "GO!";
        else {
            clearInterval(interval);
            countdownEl.style.display = 'none';
            startGame();
        }
    }, 600);
};

function startGame() {
    if (!isMuted) audioRun.play().catch(e => {});
    document.getElementById('ui-layer').style.display = 'block';
    isGameActive = true;
    clock.start();
    spawnLoop();
    spawnSceneryLoop();
}

function updateThemeColor() {
    let targetHex = THEMES[0].color;
    for (let t of THEMES) {
        if (score >= t.score) targetHex = t.color;
    }
    const targetColor = new THREE.Color(targetHex);
    currentThemeColor.lerp(targetColor, 0.05);

    if (floorMesh) floorMesh.material.color.copy(currentThemeColor);
    if (dirLight) dirLight.color.copy(currentThemeColor);
    if (sharedSceneryMat) sharedSceneryMat.color.copy(currentThemeColor);
    
    document.getElementById('ui-layer').style.color = '#' + currentThemeColor.getHexString();
    document.getElementById('ui-layer').style.textShadow = `0 0 10px #${currentThemeColor.getHexString()}`;
    document.documentElement.style.setProperty('--main-color', '#' + currentThemeColor.getHexString());
}

function createPlayer() {
    const loader = new THREE.TextureLoader();
    loader.load('1.webp', (tex) => {
        tex.minFilter = THREE.LinearFilter;
        const aspect = tex.image.width / tex.image.height;
        const h = 2.0;
        const w = h * aspect;
        const geo = new THREE.PlaneGeometry(w, h);
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, alphaTest: 0.1 });
        player = new THREE.Mesh(geo, mat);
        player.position.y = h / 2;
        scene.add(player);

        const shadowGeo = new THREE.CircleGeometry(0.8, 32);
        const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 });
        shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
        shadowMesh.rotation.x = -Math.PI / 2;
        shadowMesh.position.y = 0.05;
        scene.add(shadowMesh);
    });
}

function createSpeedLines() {
    const count = 120; // Reduced slightly for mobile
    const geo = new THREE.BufferGeometry();
    const pos = [];
    for (let i = 0; i < count; i++) {
        pos.push((Math.random() - 0.5) * 60, (Math.random()) * 15, (Math.random() - 0.5) * 100);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.15, transparent: true, opacity: 0.4 });
    const stars = new THREE.Points(geo, mat);
    scene.add(stars);
    speedLines.push(stars);
}

function spawnLoop() {
    if (!isGameActive || isGameOver || isWon) return;
    if (obstacleMaterials.length === 0) {
        setTimeout(spawnLoop, 100);
        return;
    }

    let usedLanes = [];
    if (Math.random() > 0.7 && score > 30) {
        let lane1 = Math.floor(Math.random() * 3) - 1;
        let lane2;
        do { lane2 = Math.floor(Math.random() * 3) - 1; } while (lane2 === lane1);
        spawnSpecificObstacle(lane1);
        spawnSpecificObstacle(lane2);
        usedLanes.push(lane1, lane2);
    } else {
        if (laneDeck.length === 0) shuffleDeck();
        let chosenLane = laneDeck.pop();
        spawnSpecificObstacle(chosenLane);
        usedLanes.push(chosenLane);
    }

    if (Math.random() > 0.4) {
        let safeLanes = [-1, 0, 1].filter(x => !usedLanes.includes(x));
        if (safeLanes.length > 0) {
            let coinLane = safeLanes[Math.floor(Math.random() * safeLanes.length)];
            spawnCoin(coinLane);
        }
    }

    let delay = Math.max(500, 1100 - (score * 4)); 
    setTimeout(spawnLoop, delay);
}

function spawnSpecificObstacle(lane) {
    const ob = getFromPool(obstaclePool, () => {
        // Create new mesh only if pool empty
        const mesh = new THREE.Mesh(sharedObstacleGeo, obstacleMaterials[0]); 
        scene.add(mesh);
        return mesh;
    });

    // Pick random material from pre-loaded list
    const randomMat = obstacleMaterials[Math.floor(Math.random() * obstacleMaterials.length)];
    ob.material = randomMat;
    
    ob.position.set(lane * CONFIG.laneWidth, 1, -80);
    obstacles.push(ob);
}

function spawnCoin(lane) {
    const coin = getFromPool(coinPool, () => {
        const c = new THREE.Mesh(sharedCoinGeo, sharedCoinMat);
        const inner = new THREE.Mesh(sharedInnerCoinGeo, sharedInnerCoinMat);
        c.add(inner);
        scene.add(c);
        return c;
    });

    coin.position.set(lane * CONFIG.laneWidth, 1.5, -80);
    coin.rotation.set(0,0,0);
    coin.lane = lane;
    coins.push(coin);
}

function spawnSceneryLoop() {
    if (!isGameActive || isGameOver) return;
    spawnSideBuilding();
    setTimeout(spawnSceneryLoop, 400);
}

function spawnSideBuilding() {
    const line = getFromPool(sceneryPool, () => {
        const edges = new THREE.EdgesGeometry(sharedSceneryGeo);
        const l = new THREE.LineSegments(edges, sharedSceneryMat);
        scene.add(l);
        return l;
    });

    const h = Math.random() * 5 + 2;
    line.scale.set(1, h, 1); // Scale instead of new geometry
    const xPos = Math.random() > 0.5 ? 15 : -15;
    line.position.set(xPos, h / 2 - 2, -100);
    scenery.push(line);
}

function showScorePopup(val) {
    const div = document.createElement('div');
    div.className = 'score-popup';
    div.innerText = "+" + val;
    div.style.left = (window.innerWidth / 2) + 'px';
    div.style.top = (window.innerHeight / 2 - 100) + 'px';
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 1000);
}

function createExplosion(pos) {
    // Simple particle explosion without pooling (rare event)
    for (let i = 0; i < 20; i++) {
        const geo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
        const mat = new THREE.MeshBasicMaterial({ color: currentThemeColor });
        const p = new THREE.Mesh(geo, mat);
        p.position.copy(pos);
        p.userData = {
            vel: new THREE.Vector3(
                (Math.random() - 0.5) * 0.5,
                (Math.random()) * 0.5,
                (Math.random() - 0.5) * 0.5
            )
        };
        scene.add(p);
        particles.push(p);
    }
}

// --- MAIN UPDATE LOOP ---
function update() {
    updateThemeColor();
    const dt = clock.getDelta(); // Delta time in seconds
    const moveDist = gameSpeed * dt; // Smooth movement calculation

    if (shakeIntensity > 0) {
        camera.position.x += (Math.random() - 0.5) * shakeIntensity;
        camera.position.y += (Math.random() - 0.5) * shakeIntensity;
        shakeIntensity *= 0.9;
    }

    if (!isGameActive) {
        if (floorMesh) floorMesh.material.map.offset.y -= 0.3 * dt;
        camera.position.x = Math.sin(Date.now() * 0.001) * 0.5;
        camera.lookAt(0, 1, -10);
        return;
    }

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.position.add(p.userData.vel);
        p.rotation.x += 6.0 * dt;
        p.scale.multiplyScalar(0.9);
        if (p.scale.x < 0.01) {
            scene.remove(p); // Remove particles completely (rare enough)
            particles.splice(i, 1);
        }
    }

    if (isGameOver) return;
    if (!isWon) floorMesh.material.map.offset.y -= (moveDist * 0.05);

    // Player Movement
    if (player) {
        const targetX = currentLane * CONFIG.laneWidth;
        // Smooth Damping
        player.position.x = THREE.MathUtils.damp(player.position.x, targetX, 15, dt);
        player.rotation.z = -(player.position.x - targetX) * 0.1;
        player.position.y = 1 + Math.sin(Date.now() * 0.015) * 0.1;
        
        if (shadowMesh) {
            shadowMesh.position.x = player.position.x;
            const scale = 1 - (player.position.y - 1) * 0.4;
            shadowMesh.scale.set(scale, scale, 1);
        }
        
        const idealCamX = player.position.x * 0.4;
        camera.position.x = THREE.MathUtils.damp(camera.position.x, idealCamX, 5, dt);
        camera.lookAt(player.position.x * 0.15, 1, -10);
    }

    // Speed Lines
    speedLines.forEach(p => {
        p.position.z += moveDist * 2;
        if (p.position.z > 20) p.position.z = -50;
    });

    // Scenery
    for (let i = scenery.length - 1; i >= 0; i--) {
        let b = scenery[i];
        b.position.z += moveDist;
        if (b.position.z > 10) {
            returnToPool(b, sceneryPool, scenery);
        }
    }

    // Coins
    for (let i = coins.length - 1; i >= 0; i--) {
        let c = coins[i];
        c.position.z += moveDist;
        c.rotation.y += 3.0 * dt;
        
        // Collision
        if (c.position.z > -1 && c.position.z < 1) {
            if (Math.abs(c.position.x - (player ? player.position.x : 0)) < 1.0) {
                if (!isMuted) { audioCoin.currentTime = 0; audioCoin.play(); }
                score += 20;
                document.getElementById('score').innerText = score;
                showScorePopup(20);
                returnToPool(c, coinPool, coins);
                checkWin();
                continue;
            }
        }
        if (c.position.z > 5) {
            returnToPool(c, coinPool, coins);
        }
    }

    // Obstacles
    for (let i = obstacles.length - 1; i >= 0; i--) {
        let ob = obstacles[i];
        ob.position.z += moveDist;
        
        // Collision
        if (ob.position.z > -1 && ob.position.z < 1) {
            if (Math.abs(ob.position.x - (player ? player.position.x : 0)) < 1.0) {
                gameOver();
            }
        }
        if (ob.position.z > 5) {
            returnToPool(ob, obstaclePool, obstacles);
            if (!isGameOver && !isWon) {
                score += 10;
                document.getElementById('score').innerText = score;
                if (gameSpeed < 85) gameSpeed += 0.5;
                checkWin();
            }
        }
    }

    if (isWon && player) {
        player.position.z -= 10 * dt;
        player.position.y += 2 * dt;
        player.scale.multiplyScalar(0.98);
        if (shadowMesh) shadowMesh.visible = false;
    }
}

function checkWin() {
    if (score >= CONFIG.maxScore && !isWon) {
        isWon = true;
        saveHighScore();
        triggerPortalEffect();
    }
}

function saveHighScore() {
    if (score > highScore) {
        localStorage.setItem('raikuHighScore', score);
        highScore = score;
        document.getElementById('high-score').innerText = "BEST: " + highScore;
    }
}

function triggerPortalEffect() {
    audioRun.pause();
    if (!isMuted) audioTeleport.play();

    // Clear active objects immediately
    obstacles.forEach(ob => ob.visible = false);
    coins.forEach(c => c.visible = false);
    scenery.forEach(s => s.visible = false);
    obstacles = []; coins = []; scenery = [];

    const portal = document.getElementById('portal-visual');
    portal.style.opacity = '1';
    portal.classList.add('portal-active');

    setTimeout(() => {
        document.getElementById('win-message').style.display = 'none';
        document.getElementById('troll-message').style.display = 'block';
        if (!isMuted) audioNoAirdrop.play();
        audioNoAirdrop.onended = function() {
            document.getElementById('white-flash').style.opacity = '1';
            setTimeout(() => {
                window.location.href = CONFIG.redirect;
            }, 500);
        };
    }, 3000);
}

function gameOver() {
    createExplosion(player.position);
    player.visible = false;
    shadowMesh.visible = false;
    shakeIntensity = 0.5;
    audioRun.pause(); audioRun.currentTime = 0;
    if (!isMuted) audioCrash.play();
    isGameOver = true;
    saveHighScore();
    document.getElementById('final-score-text').innerText = "SCORE: " + score;
    document.getElementById('overlay').style.display = 'flex';
}

function animate() {
    requestAnimationFrame(animate);
    update();
    renderer.render(scene, camera);
}

function onKeyDown(e) {
    if (!isGameActive) return;
    if (isGameOver) {
        if (e.key === 'Enter') location.reload();
        return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'a') if (currentLane > -1) currentLane--;
    if (e.key === 'ArrowRight' || e.key === 'd') if (currentLane < 1) currentLane++;
}

// --- IMPROVED TOUCH HANDLING ---
function setupTouch() {
    let startX = 0;
    let isSwiping = false;

    document.addEventListener('touchstart', e => {
        startX = e.changedTouches[0].screenX;
        isSwiping = false;
    }, { passive: false });

    document.addEventListener('touchmove', e => {
        if (!isGameActive || isGameOver) return;
        e.preventDefault();

        if (isSwiping) return;

        const currentX = e.changedTouches[0].screenX;
        const diffX = currentX - startX;
        const threshold = 30;

        if (Math.abs(diffX) > threshold) {
            if (diffX > 0 && currentLane < 1) {
                currentLane++;
                isSwiping = true;
            } else if (diffX < 0 && currentLane > -1) {
                currentLane--;
                isSwiping = true;
            }
        }
    }, { passive: false });

    document.addEventListener('touchend', () => isSwiping = false);
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

init();