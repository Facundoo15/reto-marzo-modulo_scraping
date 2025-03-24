const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { createObjectCsvWriter } = require("csv-writer");
require("dotenv").config();

const BASE_URL = "https://tottus.falabella.com.pe/tottus-pe/category/cat13380487/Despensa";

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 200;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}

async function extractProducts(page) {
  try {
    await page.waitForSelector(".pod.pod-2_GRID.pod-link", { timeout: 5000 });
  } catch (err) {
    console.warn("No se encontraron productos en esta página.");
    return [];
  }

  return page.evaluate(() => {
    return Array.from(document.querySelectorAll(".pod.pod-2_GRID.pod-link")).map((item) => {
      const imgEl = item.querySelector("picture img");
      const imageUrl = imgEl?.getAttribute("src") || imgEl?.getAttribute("data-src") || "Sin imagen";

      return {
        category: "Despensa",
        subcategory: item.closest(".section")?.querySelector(".section-title")?.innerText.trim() || "Sin subcategoría",
        name: item.querySelector(".pod-subTitle")?.innerText.trim() || "Sin nombre",
        brand: item.querySelector(".pod-title")?.innerText.trim() || "Sin marca",
        price: item.querySelector(".prices-0 span")?.innerText.trim() || "Sin precio",
        image: imageUrl,
        link: item.href ? `https://tottus.falabella.com.pe${item.getAttribute("href")}` : "Sin enlace"
      };
    });
  });
}


async function extractProducts(page) {
  try {
    await page.waitForSelector(".pod.pod-2_GRID.pod-link", { timeout: 5000 });
  } catch (err) {
    console.warn("No se encontraron productos en esta página.");
    return [];
  }

  return page.evaluate(() => {
    return Array.from(document.querySelectorAll(".pod.pod-2_GRID.pod-link")).map((item) => ({
      category: "Despensa",
      subcategory: item.closest(".section")?.querySelector(".section-title")?.innerText.trim() || "Sin subcategoría",
      name: item.querySelector(".pod-subTitle")?.innerText.trim() || "Sin nombre",
      brand: item.querySelector(".pod-title")?.innerText.trim() || "Sin marca",
      price: item.querySelector(".prices-0 span")?.innerText.trim() || "Sin precio",
      image: item.querySelector("picture img")?.src || "Sin imagen",
      link: item.href ? `https://tottus.falabella.com.pe${item.getAttribute("href")}` : "Sin enlace"
    }));
  });
}

// Clasifica si la imagen es de un empaque flexible
async function detectFlexiblePackaging(imageUrl) {
  if (!imageUrl.startsWith("http")) return "No aplica";

  try {
    const imageBuffer = await axios.get(imageUrl, { responseType: "arraybuffer" });
    const { data } = await axios.post(
      "https://api-inference.huggingface.co/models/google/vit-base-patch16-224",
      imageBuffer.data,
      {
        headers: {
          Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
          "Content-Type": "application/octet-stream",
        },
        timeout: 4000,
      }
    );

    const isFlexible = data.some(pred =>
      ["plastic", "bag", "package", "wrap", "film", "pouch"].some(keyword =>
        pred.label.toLowerCase().includes(keyword)
      )
    );

    return isFlexible ? "Sí" : "No";
  } catch (err) {
    console.error("Error clasificando imagen:", err.response?.data || err.message);
    return "Error";
  }
}

function exportToJSON(data, filename = "productos.json") {
  if (data.length) {
    fs.writeFileSync(filename, JSON.stringify(data, null, 2), "utf-8");
    console.log(`JSON guardado en ${filename}`);
  } else {
    console.warn("No hay datos para exportar en JSON.");
  }
}

async function exportToCSV(data, filename = "productos.csv") {
  if (!data.length) return console.warn("No hay datos para exportar en CSV.");

  const writer = createObjectCsvWriter({
    path: filename,
    header: [
      { id: "category", title: "Categoría" },
      { id: "subcategory", title: "Subcategoría" },
      { id: "name", title: "Nombre" },
      { id: "brand", title: "Marca" },
      { id: "price", title: "Precio" },
      { id: "image", title: "Imagen (URL)" },
      { id: "link", title: "Enlace" },
      { id: "flexible", title: "Es flexible" }
    ],
  });

  await writer.writeRecords(data);
  console.log(`CSV guardado en ${filename}`);
}

async function main() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  let pageNumber = 1;
  const productsList = [];

  while (true) {
    const url = `${BASE_URL}?page=${pageNumber}`;
    console.log(`Scrapeando: ${url}`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 0 });
    await autoScroll(page);  // Autoscroll
    const products = await extractProducts(page);
    if (!products.length) {
      console.log("No se encontraron más productos, terminando scraping.");
      break;
    }

    for (const product of products) {
      product.flexible = await detectFlexiblePackaging(product.image);
      console.log(`Producto: ${product.name} - Flexible: ${product.flexible}`);
      productsList.push(product);
    }

    pageNumber++;
  }

  await browser.close();

  exportToJSON(productsList);
  await exportToCSV(productsList);
  console.log("Proceso completado.");
}

main();
