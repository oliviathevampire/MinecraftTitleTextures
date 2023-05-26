import { Canvas, loadImage, ImageData } from "skia-canvas"
import compress_images from "compress-images"

import fs from "node:fs"
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
    
    // const word = '┣Minecr😳ft┫'.toLowerCase();
    const word = "abcde"
    // let word;
    // if (font.id === "minecraft-five-bold-block" ) word = "┣abcde┫";
    // else word = 'abcde';
    const thumbnailLetterCount = Array.from(word).length;

    let x = 0;
    let y = 0;
    
    const {chars, texture_base_width, letterSpacing, yOffset} = JSON.parse(fs.readFileSync(`../fonts/${font.id}/config.json`))
    
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
        const pos = {
          x,
          y: font.ends[char.row][1],
        };
        x += char.width + 2;
        return {
          ...char,
          ...pos,
        };
      });

    const textureScale = canvas.width / texture_base_width
    const canvasWidth = [...word].reduce((sum, letter) => {
      return sum + charData.find(data => data.character === letter).width + letterSpacing
    }, 0);
    const thumbnail = new Canvas(canvasWidth * textureScale, font.height * textureScale)
    const ctx = thumbnail.getContext("2d")
    
    // const yOffset = (font.height - (font.ends[0][2] - font.ends[0][1])) / 2;
    let targetX = letterSpacing / 2;
    for (let i = 0; i < thumbnailLetterCount; i++) {
      const letter = Array.from(word)[i];
      const letterData = charData.find(data => data.character === letter);
      copyLetter(
        ctx,
        canvas,
        letterData.x * textureScale, // sourcex
        letterData.y * textureScale, // sourcey
        letterData.width * textureScale, // sourcew
        letterData.height * textureScale, // sourceh
        targetX * textureScale, // targetx
        (yOffset + (letterSpacing / 2)) * textureScale,
      );
      targetX += letterData.width + letterSpacing;
    }

    if (file[0] === "textures") {
      outline(thumbnail, 2 * textureScale, context.getImageData(0, font.border * textureScale, 1, 1).data)
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
    /* target-y */ sourceH,
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