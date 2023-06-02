import { Canvas, loadImage, ImageData } from "skia-canvas"
import compress_images from "compress-images"

import fs, { write } from "node:fs"
import path from 'node:path';

fs.rmSync("temp", { recursive: true, force: true })

const charMap = {
  asterisk: "*",
  backwardslash: "\\",
  colon: ":",
  creeper: "😳",
  end: "┣",
  forwardslash: "/",
  greaterthan: ">",
  lessthan: "<",
  openquote: "😩",
  questionmark: "?",
  space: " ",
  spacer: "​",
  start: "┫"
}

const fonts = JSON.parse(fs.readFileSync("../fonts.json"))
fonts.push({
  id: "minecraft-ten",
  width: 32,
  height: 44,
  border: 266,
  ends: [
    [0, 22, 62, 84],
    [86, 108, 148, 170],
    [172, 194, 234, 256]
  ]
})

function outline(canvas, size, colour) {
  const ctx = canvas.getContext("2d")
  const width = canvas.width
  const height = canvas.height
  const data = ctx.getImageData(0, 0, width, height).data
  const data2 = data.slice()
  const length = data.length

  for (let i = 0; i < length; i += 4) {
    let a = data[i + 3]
    if (a !== 255) {
      const x = i / 4 % width
      const y = Math.floor(i / 4 / width)
      const cx =  Math.min(width - 1, x + size) - x
      const cy = Math.min(height - 1, y + size) - y
      loop:
      for (let sy = Math.max(0, y - size) - y; sy <= cy; sy++) {
        for (let sx = Math.max(0, x - size) - x; sx <= cx; sx++) {
          a = Math.max(a, data[i + (sx + sy * width) * 4 + 3])
          if (a === 255) break loop
        }
      }
      if (!a) continue
      data2[i] = colour[0]
      data2[i + 1] = colour[1]
      data2[i + 2] = colour[2]
      data2[i + 3] = 255
    }
  }
  ctx.putImageData(new ImageData(data2, width, height), 0, 0)
}

for (const font of fonts) {
  const characters = {}
  
  for (const file of fs.readdirSync(`../fonts/${font.id}/characters`)) {
    const char = charMap[file.slice(0, -5)] ?? file.slice(0, -5)
    characters[char] = JSON.parse(fs.readFileSync(`../fonts/${font.id}/characters/${file}`, "utf8")).elements
    for (const element of characters[char]) {
      for (const [direction, face] of Object.entries(element.faces)) {
        element.faces[direction] = face.uv
      }
    }
  }

  fs.writeFileSync(`../fonts/${font.id}/characters.json`, JSON.stringify(characters))

  console.log(`Done ${font.id} characters`)

  fs.mkdirSync(`temp/${font.id}/textures`, { recursive: true })
  fs.mkdirSync(`temp/${font.id}/overlays`, { recursive: true })
  fs.mkdirSync(`temp/${font.id}/thumbnails`, { recursive: true })

  let overlayBackground
  const textures = fs.readdirSync(`../fonts/${font.id}/textures`).map(e => ["textures", e]).concat(fs.readdirSync(`../fonts/${font.id}/overlays`).map(e => ["overlays", e]))
  for (const file of textures) {
    if (file[1] === "overlay.png") continue

    const img = await loadImage(`../fonts/${font.id}/${file[0]}/${file[1]}`)
    
    const canvas = new Canvas(img.width, img.height)
    const context = canvas.getContext("2d")
    context.drawImage(img, 0, 0)
    canvas.saveAs(`temp/${font.id}/${file[0]}/${file[1]}`)
    
    const word = "abcde"
    const thumbnailLetterCount = Array.from(word).length;

    let x = 0;
    let y = 0;
    
    const {chars, texture_base_width, letterSpacing, yOffset, extraCharacterData} = JSON.parse(fs.readFileSync(`../fonts/${font.id}/config.json`))
    
    const charData = Object.keys(characters)
      .map((c) => {
        const sizeData = characters[c][0];
        const width = sizeData.to[0] - sizeData.from[0];
        const row = chars.findIndex((rowChars) => rowChars.includes(c));
        const height = font.ends[row][2] - font.ends[row][1];
        
        const col = [...chars[row]].indexOf(c);
        return { character: c, width, height, row, col };
      }).sort((a, b) => {
        if (a.row === b.row) return a.col - b.col;
        return a.row - b.row;
      }).map((char) => {
        if (y < char.row) {
          y = char.row;
          x = 0;
        }
        if (extraCharacterData?.[char.character]?.offsetLeft) {
          x += extraCharacterData[char.character]?.offsetLeft;
        }
        const pos = {
          x,
          y: font.ends[char.row][1],
        };
        if (extraCharacterData?.[char.character]?.offsetRight) {
          x += extraCharacterData[char.character]?.offsetRight;
        }
        x += char.width + 2;
        return {
          ...char,
          ...pos,
        };
      });

    let borderSize
    if (font.borderless) {
      borderSize = 0
    } else {
      borderSize = 2
    }
    
    const textureScale = canvas.width / texture_base_width

    const openTerminator = charData.find(data => data.character === charMap.start);
    const closeTerminator = charData.find(data => data.character === charMap.end);

    const canvasWidth = [...word].reduce((sum, letter) => {
      return sum + charData.find(data => data.character === letter).width + letterSpacing
    }, 0);
    // const thumbnail = new Canvas(canvasWidth * textureScale, font.height * textureScale)
    let thumbnail
    if (font.autoBorder || font.borderless) {
      if (font.forcedTerminators) {
        thumbnail = new Canvas(
          canvasWidth * textureScale + borderSize * 2 + openTerminator.width * textureScale + closeTerminator.width * textureScale, 
          font.height * textureScale
        )
      } else {
        thumbnail = new Canvas(canvasWidth * textureScale - borderSize * 4, font.height * textureScale)
      }
    } else {
      if (font.forcedTerminators) {
        thumbnail = new Canvas(canvasWidth * textureScale + borderSize * 4 + font.forcedTerminators[4] * 2, font.height * textureScale)
      } else {
        thumbnail = new Canvas(canvasWidth * textureScale, font.height * textureScale)
      }
    }
    const ctx = thumbnail.getContext("2d")
    let targetX = borderSize;

    function writeLetter(characterToWrite, addsSpace) {
      copyLetter(
        ctx,
        canvas,
        characterToWrite.x * textureScale, // sourcex
        characterToWrite.y * textureScale, // sourcey
        characterToWrite.width * textureScale, // sourcew
        characterToWrite.height * textureScale, // sourceh
        targetX * textureScale, // targetx
        (yOffset + borderSize) * textureScale, //targety
      )
      if (addsSpace) targetX += characterToWrite.width;
    }

    function insertSpacer() {
      const spacer = charData.find(data => data.character === charMap.spacer);
      if (spacer) {
        const numSpaces = letterSpacing / spacer.width;
        for (let spaceIndex = 0; spaceIndex < numSpaces; spaceIndex++) {
          writeLetter(spacer, true);
        }
      } else {
        targetX += letterSpacing;
      }
    }

    if (font.forcedTerminators != null) writeLetter(openTerminator, true);
    for (let i = 0; i < thumbnailLetterCount; i++) {
      writeLetter(charData.find(data => data.character === Array.from(word)[i]), true);
      insertSpacer();
    }
    if (font.forcedTerminators != null) writeLetter(closeTerminator, false);

    if (file[0] === "textures") {
      if (!font.borderless) outline(thumbnail, 2 * textureScale, context.getImageData(0, font.border * textureScale, 1, 1).data)
    } else {
      ctx.globalCompositeOperation = "destination-over"
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(overlayBackground, 0, 0, thumbnail.width, thumbnail.height)
    }

    thumbnail.saveAs(`temp/${font.id}/thumbnails/${file[1]}`)

    if (file[1] === "flat.png") {
      overlayBackground = new Canvas(thumbnail.width, thumbnail.height)
      const overlayBackgroundCtx = overlayBackground.getContext("2d")
      overlayBackgroundCtx.drawImage(thumbnail, 0, 0)
      overlayBackgroundCtx.fillStyle = "rgb(0,0,0,0.25)"
      overlayBackgroundCtx.globalCompositeOperation = "destination-in"
      overlayBackgroundCtx.fillRect(0, 0, thumbnail.width, thumbnail.height)
      overlayBackgroundCtx.globalCompositeOperation = "source-over"
      overlayBackground.saveAs(`temp/${font.id}/thumbnails/none.png`)
    }
  }
}

function copyLetter(
  target, source,
  sourceX, sourceY, sourceW, sourceH,
  targetX, targetY,
) {
  target.drawImage(
    source,
    /* source-x */ sourceX,
    /* source-y */ sourceY,
    /* source-w */ sourceW,
    /* source-h */ sourceH,
    /* target-x */ targetX,
    /* target-y */ targetY,
    /* target-w */ sourceW,
    /* target-h */ sourceH,
  );
}

console.log("Compressing textures...")

compress_images("temp/**/*.png", "../fonts/", {
  statistic: true,
  autoupdate: true,
  compress_force: true,
}, false,
  { jpg: { engine: false, command: false } },
  { png: { engine: "optipng", command: ["-backup"] } },
  { svg: { engine: false, command: false } },
  { gif: { engine: false, command: false } },
(err, comp, stat) => {
  if (fs.existsSync(stat.path_out_new + ".bak")) fs.unlinkSync(stat.path_out_new + ".bak")
})