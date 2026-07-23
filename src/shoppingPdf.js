function pdfText(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/([\\()])/g, "\\$1");
}

function wrap(value, width = 82) {
  const words = String(value).trim().split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (!line) line = word;
    else if (`${line} ${word}`.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

/**
 * @param {{ weekLabel: string, items: Array<{ ingredient: string, quantity: string, meals: string[] }> }} input
 * @returns {Uint8Array}
 */
export function buildShoppingListPdf({ weekLabel, items }) {
  const rows = [];
  for (const item of items) {
    rows.push({ text: `${item.ingredient}  -  Qty ${item.quantity}`, bold: true });
    if (item.meals.length) {
      for (const line of wrap(`For: ${item.meals.join(", ")}`)) rows.push({ text: line, bold: false });
    } else rows.push({ text: "Pantry staple", bold: false });
    rows.push({ text: "", bold: false });
  }

  const rowsPerPage = 44;
  const pages = [];
  for (let index = 0; index < Math.max(1, rows.length); index += rowsPerPage) pages.push(rows.slice(index, index + rowsPerPage));
  const pageObjectIds = pages.map((_, index) => 5 + index * 2);
  const objects = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

  pages.forEach((pageRows, pageIndex) => {
    const pageId = pageObjectIds[pageIndex];
    const contentId = pageId + 1;
    const commands = [
      `BT /F2 20 Tf 1 0 0 1 54 744 Tm (${pdfText("Supper Shuffle Shopping List")}) Tj ET`,
      `BT /F1 11 Tf 1 0 0 1 54 722 Tm (${pdfText(`Week of ${weekLabel}`)}) Tj ET`,
    ];
    pageRows.forEach((row, rowIndex) => {
      const y = 694 - rowIndex * 14;
      commands.push(`BT /${row.bold ? "F2" : "F1"} ${row.bold ? 11 : 9} Tf 1 0 0 1 54 ${y} Tm (${pdfText(row.text)}) Tj ET`);
    });
    const stream = commands.join("\n");
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = output.length;
    output += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = output.length;
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) output += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(output);
}
