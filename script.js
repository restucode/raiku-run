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

const audioIntro = new Audio('sfx/firstmusic.mp3');
audioIntro.loop = true;
audioIntro.volume = 0.5;

const audioRun = new Audio('sfx/run.mp3');
audioRun.loop = true;
audioRun.volume = 0.5;

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
    
    if (!isMuted && !isGameActive && audioIntro.paused) {
        audioIntro.play();
    }
}

let scene, camera, renderer;
let player, shadowMesh, floorMesh, dirLight;
let obstacles = [], coins = [], scenery = [], speedLines = [], particles = [];
let loadedObstacleTextures = [];
let score = 0;
let isGameActive = false;
let isGameOver = false;
let isWon = false;
let currentLane = 0;
let gameSpeed = 0.6;
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
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.03);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 5, 9);
    camera.lookAt(0, 1, -10);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.body.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambient);

    dirLight = new THREE.DirectionalLight(currentThemeColor, 0.8);
    dirLight.position.set(0, 10, 5);
    scene.add(dirLight);

    const gridCanvas = document.createElement('canvas');
    gridCanvas.width = 64;
    gridCanvas.height = 64;
    const ctx = gridCanvas.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, 64, 64);
    
    const gridTexture = new THREE.CanvasTexture(gridCanvas);
    gridTexture.wrapS = THREE.RepeatWrapping;
    gridTexture.wrapT = THREE.RepeatWrapping;
    gridTexture.repeat.set(20, 20);

    const floorGeo = new THREE.PlaneGeometry(200, 200);
    const floorMat = new THREE.MeshBasicMaterial({ map: gridTexture, color: currentThemeColor });
    floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    scene.add(floorMesh);

    createPlayer();
    createSpeedLines();
    preloadObstacleTextures();
    shuffleDeck();

    document.addEventListener('keydown', onKeyDown);
    setupTouch();
    window.addEventListener('resize', onResize);

    document.getElementById('max-score').innerText = CONFIG.maxScore;
    document.getElementById('high-score').innerText = "BEST: " + highScore;
    updateThemeColor();

    audioIntro.play().catch(() => {
        const unlockAudio = () => {
            if(!isGameActive && !isMuted) audioIntro.play();
            document.removeEventListener('click', unlockAudio);
            document.removeEventListener('touchstart', unlockAudio);
        };
        document.addEventListener('click', unlockAudio);
        document.addEventListener('touchstart', unlockAudio);
    });

    animate();
}

window.initiateGame = function() {
    audioIntro.pause();
    document.getElementById('start-screen').style.display = 'none';
    const countdownEl = document.getElementById('countdown');
    countdownEl.style.display = 'block';
    let count = 3;
    const interval = setInterval(() => {
        count--;
        if (count > 0) {
            countdownEl.innerText = count;
        } else if (count === 0) {
            countdownEl.innerText = "GO!";
        } else {
            clearInterval(interval);
            countdownEl.style.display = 'none';
            startGame();
        }
    }, 600);
};

function startGame() {
    if (!isMuted) audioRun.play().catch(e => console.log("Audio play failed:", e));
    document.getElementById('ui-layer').style.display = 'block';
    isGameActive = true;
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
    document.getElementById('ui-layer').style.color = '#' + currentThemeColor.getHexString();
    document.getElementById('ui-layer').style.textShadow = `0 0 10px #${currentThemeColor.getHexString()}`;
    document.documentElement.style.setProperty('--main-color', '#' + currentThemeColor.getHexString());
}

function preloadObstacleTextures() {
    const loader = new THREE.TextureLoader();
    OBSTACLE_FILES.forEach(filename => {
        loader.load('assets/' + filename, (tex) => {
            tex.minFilter = THREE.LinearFilter;
            loadedObstacleTextures.push(tex);
        });
    });
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
    const count = 150;
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
    if (loadedObstacleTextures.length === 0) {
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

    let delay = Math.max(500, 1100 - (score * 6));
    setTimeout(spawnLoop, delay);
}

function spawnSceneryLoop() {
    if (!isGameActive || isGameOver) return;
    spawnSideBuilding();
    setTimeout(spawnSceneryLoop, 400);
}

function spawnSideBuilding() {
    const h = Math.random() * 5 + 2;
    const geo = new THREE.BoxGeometry(2, h, 2);
    const edges = new THREE.EdgesGeometry(geo);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: currentThemeColor }));
    const xPos = Math.random() > 0.5 ? 15 : -15;
    line.position.set(xPos, h / 2 - 2, -100);
    scene.add(line);
    scenery.push(line);
}

function spawnSpecificObstacle(lane) {
    const randomTex = loadedObstacleTextures[Math.floor(Math.random() * loadedObstacleTextures.length)];
    const geo = new THREE.PlaneGeometry(2, 2);
    const mat = new THREE.MeshBasicMaterial({ map: randomTex, transparent: true, side: THREE.DoubleSide, alphaTest: 0.1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(lane * CONFIG.laneWidth, 1, -80);
    scene.add(mesh);
    obstacles.push(mesh);
}

function spawnCoin(lane) {
    const geo = new THREE.OctahedronGeometry(0.5);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffeb3b, wireframe: true });
    const coin = new THREE.Mesh(geo, mat);
    const innerGeo = new THREE.OctahedronGeometry(0.4);
    const innerMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
    const inner = new THREE.Mesh(innerGeo, innerMat);
    coin.add(inner);
    coin.position.set(lane * CONFIG.laneWidth, 1.5, -80);
    coin.lane = lane;
    scene.add(coin);
    coins.push(coin);
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
    for (let i = 0; i < 30; i++) {
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

function update() {
    updateThemeColor();

    if (shakeIntensity > 0) {
        camera.position.x += (Math.random() - 0.5) * shakeIntensity;
        camera.position.y += (Math.random() - 0.5) * shakeIntensity;
        shakeIntensity *= 0.9;
    }

    if (!isGameActive) {
        if (floorMesh) floorMesh.material.map.offset.y -= 0.005;
        camera.position.x = Math.sin(Date.now() * 0.001) * 0.5;
        camera.lookAt(0, 1, -10);
        return;
    }

    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.position.add(p.userData.vel);
        p.rotation.x += 0.1;
        p.scale.multiplyScalar(0.95);
        if (p.scale.x < 0.01) {
            scene.remove(p);
            particles.splice(i, 1);
        }
    }

    if (isGameOver) return;
    if (!isWon) floorMesh.material.map.offset.y -= (gameSpeed * 0.05);

    if (player) {
        const targetX = currentLane * CONFIG.laneWidth;
        player.position.x += (targetX - player.position.x) * 0.2;
        player.rotation.z = -(player.position.x - targetX) * 0.1;
        player.position.y = 1 + Math.sin(Date.now() * 0.015) * 0.1;
        if (shadowMesh) {
            shadowMesh.position.x = player.position.x;
            const scale = 1 - (player.position.y - 1) * 0.4;
            shadowMesh.scale.set(scale, scale, 1);
        }
        const idealCamX = player.position.x * 0.4;
        camera.position.x += (idealCamX - camera.position.x) * 0.05;
        camera.lookAt(player.position.x * 0.15, 1, -10);
    }

    speedLines.forEach(p => {
        p.position.z += gameSpeed * 2;
        if (p.position.z > 20) p.position.z = -50;
    });

    for (let i = scenery.length - 1; i >= 0; i--) {
        let b = scenery[i];
        b.position.z += gameSpeed;
        b.material.color.copy(currentThemeColor);
        if (b.position.z > 10) {
            scene.remove(b);
            scenery.splice(i, 1);
        }
    }

    for (let i = coins.length - 1; i >= 0; i--) {
        let c = coins[i];
        c.position.z += gameSpeed;
        c.rotation.y += 0.05;
        if (c.position.z > -1 && c.position.z < 1) {
            if (Math.abs(c.position.x - (player ? player.position.x : 0)) < 1.0) {
                if (!isMuted) {
                    audioCoin.currentTime = 0;
                    audioCoin.play();
                }
                score += 20;
                document.getElementById('score').innerText = score;
                showScorePopup(20);
                scene.remove(c);
                coins.splice(i, 1);
                checkWin();
                continue;
            }
        }
        if (c.position.z > 5) {
            scene.remove(c);
            coins.splice(i, 1);
        }
    }

    for (let i = obstacles.length - 1; i >= 0; i--) {
        let ob = obstacles[i];
        ob.position.z += gameSpeed;
        if (ob.position.z > -1 && ob.position.z < 1) {
            if (Math.abs(ob.position.x - (player ? player.position.x : 0)) < 1.0) {
                gameOver();
            }
        }
        if (ob.position.z > 5) {
            scene.remove(ob);
            obstacles.splice(i, 1);
            if (!isGameOver && !isWon) {
                score += 10;
                document.getElementById('score').innerText = score;
                if (gameSpeed < 1.5) gameSpeed += 0.005;
                checkWin();
            }
        }
    }
    if (isWon && player) {
        player.position.z -= 0.5;
        player.position.y += 0.05;
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

    obstacles.forEach(ob => scene.remove(ob));
    obstacles = [];
    coins.forEach(c => scene.remove(c));
    coins = [];
    scenery.forEach(s => scene.remove(s));
    scenery = [];

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

    audioRun.pause();
    audioRun.currentTime = 0;
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

function setupTouch() {
    let startX = 0;
    let startY = 0;

    document.addEventListener('touchstart', e => {
        startX = e.changedTouches[0].screenX;
        startY = e.changedTouches[0].screenY;
    }, { passive: false });

    document.addEventListener('touchmove', e => {
        if (isGameActive && !isGameOver) {
            e.preventDefault();
        }
    }, { passive: false });

    document.addEventListener('touchend', e => {
        if (!isGameActive || isGameOver) return;

        const endX = e.changedTouches[0].screenX;
        const diffX = endX - startX;

        if (Math.abs(diffX) > 30) {
            if (diffX > 0 && currentLane < 1) currentLane++;
            else if (diffX < 0 && currentLane > -1) currentLane--;
        }
    }, { passive: false });
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

init();