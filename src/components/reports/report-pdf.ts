/**
 * PDF do relatório visual da sessão, gerado no navegador com jsPDF.
 * Os gráficos são renderizados fora da tela em tema claro (instância ECharts dedicada →
 * `getDataURL`), independentemente do tema do admin, para ficarem legíveis no papel.
 * O PDF não contém dados de contato de participantes.
 */
import type { jsPDF as JsPDF } from "jspdf";
import { SESSION_STATUS_LABELS, QUESTION_TYPE_LABELS } from "@shared/schemas";
import { buildChartOption, buildSatisfactionPie, buildSatisfactionTimeline } from "@shared/charts/options";
import { buildSimpleBarOption, toResultsDTO } from "./report-ui";
import type { SessionReport } from "./types";

type Opt = Record<string, unknown>;

const NAVY: [number, number, number] = [11, 23, 54];
const BRAND: [number, number, number] = [255, 0, 104];
const MUTED: [number, number, number] = [91, 100, 128];
const LIGHT: [number, number, number] = [241, 244, 250];

/** As fontes padrão do jsPDF cobrem apenas Latin-1: normaliza o restante. */
function pdfText(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, "...")
    .replace(/✓/g, "(correta)")
    .replace(/[^\x00-\xFF]/g, "");
}

const pct = (n: number | null | undefined, d = 0) => (n === null || n === undefined ? "-" : `${n.toLocaleString("pt-BR", { maximumFractionDigits: d })}%`);
const dt = (d: string | null | undefined) => (d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "-");
const sec = (ms: number | null) => (ms === null ? "-" : `${(ms / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s`);

async function renderPng(echarts: typeof import("echarts"), option: Opt, width: number, height: number): Promise<string> {
  const el = document.createElement("div");
  el.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;`;
  document.body.appendChild(el);
  try {
    const chart = echarts.init(el, undefined, { renderer: "canvas", width, height });
    chart.setOption({ ...option, animation: false }, { notMerge: true });
    const url = chart.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#FFFFFF" });
    chart.dispose();
    return url;
  } finally {
    el.remove();
  }
}

export async function exportSessionReportPdf(report: SessionReport, opts: { filename: string; filterLabel?: string | null }) {
  const [{ jsPDF }, echarts] = await Promise.all([import("jspdf"), import("echarts")]);
  const pdf: JsPDF = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  const m = 40;
  const cw = pw - m * 2;
  let y = m;

  const ensure = (h: number) => {
    if (y + h > ph - m - 10) {
      pdf.addPage();
      y = m;
    }
  };
  const heading = (title: string) => {
    ensure(40);
    y += 8;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(13);
    pdf.setTextColor(...NAVY);
    pdf.text(pdfText(title), m, y + 10);
    pdf.setDrawColor(...BRAND);
    pdf.setLineWidth(1.5);
    pdf.line(m, y + 16, m + 36, y + 16);
    y += 28;
  };
  const paragraph = (text: string, size = 9, color: [number, number, number] = MUTED) => {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
    const lines = pdf.splitTextToSize(pdfText(text), cw) as string[];
    ensure(lines.length * (size + 3));
    pdf.text(lines, m, y + size);
    y += lines.length * (size + 3) + 4;
  };
  const image = async (option: Opt, pxW: number, pxH: number) => {
    const h = (cw * pxH) / pxW;
    ensure(h + 6);
    const url = await renderPng(echarts, option, pxW, pxH);
    pdf.addImage(url, "PNG", m, y, cw, h);
    y += h + 8;
  };
  const table = (headers: string[], rows: (string | number)[][], widths: number[], align: ("left" | "right")[] = []) => {
    const total = widths.reduce((a, b) => a + b, 0);
    const ws = widths.map((w) => (w / total) * cw);
    const rh = 18;
    const drawHeader = () => {
      pdf.setFillColor(...NAVY);
      pdf.rect(m, y, cw, rh, "F");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.setTextColor(255, 255, 255);
      let x = m;
      headers.forEach((h, i) => {
        const right = align[i] === "right";
        pdf.text(pdfText(h), right ? x + ws[i] - 5 : x + 5, y + 12, { align: right ? "right" : "left" });
        x += ws[i];
      });
      y += rh;
    };
    ensure(rh * 2);
    drawHeader();
    rows.forEach((r, ri) => {
      if (y + rh > ph - m - 10) {
        pdf.addPage();
        y = m;
        drawHeader();
      }
      if (ri % 2 === 1) {
        pdf.setFillColor(...LIGHT);
        pdf.rect(m, y, cw, rh, "F");
      }
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(...NAVY);
      let x = m;
      r.forEach((cell, i) => {
        const right = align[i] === "right";
        const lines = pdf.splitTextToSize(pdfText(cell), ws[i] - 10) as string[];
        let text = lines[0] ?? "";
        if (lines.length > 1) text = `${text.slice(0, Math.max(0, text.length - 3))}...`;
        pdf.text(text, right ? x + ws[i] - 5 : x + 5, y + 12, { align: right ? "right" : "left" });
        x += ws[i];
      });
      y += rh;
    });
    y += 10;
  };

  /* ---------------------------------------------------------------- capa */
  const t = report.totals;
  const sat = report.satisfaction.summary;
  pdf.setFillColor(...NAVY);
  pdf.rect(0, 0, pw, 110, "F");
  pdf.setFillColor(...BRAND);
  pdf.rect(0, 110, pw, 3, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.text("GESTALT LIVE · RELATÓRIO DA SESSÃO", m, 34);
  pdf.setFontSize(18);
  pdf.text(pdfText(report.event.title), m, 58, { maxWidth: cw });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);
  pdf.text(pdfText(`${report.session.name} · código ${report.session.code} · ${SESSION_STATUS_LABELS[report.session.status] ?? report.session.status}`), m, 78, { maxWidth: cw });
  pdf.setFontSize(9);
  pdf.text(pdfText(`Início: ${dt(report.session.startedAt)}   Encerramento: ${dt(report.session.endedAt)}   Gerado em: ${dt(new Date().toISOString())}`), m, 96, { maxWidth: cw });
  y = 130;
  if (opts.filterLabel) paragraph(`Segmento aplicado: ${opts.filterLabel}`, 9, BRAND);

  /* ---------------------------------------------------------------- indicadores */
  heading("Indicadores principais");
  const kpis: [string, string][] = [
    ["Inscritos", t.registered.toLocaleString("pt-BR")],
    ["Interagiram", t.interacted.toLocaleString("pt-BR")],
    ["Taxa de participação", pct(t.participationPct)],
    ["Perguntas realizadas", `${t.questionsDone} de ${t.questions}`],
    ["Média de acertos", t.avgCorrect.toLocaleString("pt-BR", { maximumFractionDigits: 2 })],
    ["Acerto médio", pct(t.avgAccuracyPct)],
    ["Valeu a pena", sat.total ? pct(sat.positivePct) : "Sem avaliações"],
    ["Insatisfeito", sat.total ? pct(sat.negativePct) : "Sem avaliações"],
  ];
  const cols = 4;
  const gap = 8;
  const bw = (cw - gap * (cols - 1)) / cols;
  const bh = 48;
  for (let i = 0; i < kpis.length; i += cols) {
    ensure(bh + gap);
    kpis.slice(i, i + cols).forEach(([label, value], j) => {
      const x = m + j * (bw + gap);
      pdf.setFillColor(...LIGHT);
      pdf.roundedRect(x, y, bw, bh, 6, 6, "F");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7);
      pdf.setTextColor(...MUTED);
      pdf.text(pdfText(label.toUpperCase()), x + 8, y + 14);
      pdf.setFontSize(15);
      pdf.setTextColor(...NAVY);
      pdf.text(pdfText(value), x + 8, y + 36, { maxWidth: bw - 16 });
    });
    y += bh + gap;
  }
  y += 4;

  /* ---------------------------------------------------------------- satisfação */
  heading("Satisfação final");
  if (sat.total === 0) paragraph("Sem avaliações registradas nesta sessão.");
  else {
    paragraph(
      `${sat.total} avaliações registradas (${pct(report.satisfaction.participationPct)} dos inscritos). Valeu a pena: ${sat.positive} (${pct(sat.positivePct)}). Insatisfeito: ${sat.negative} (${pct(sat.negativePct)}). Percentuais calculados apenas sobre avaliações registradas.`,
    );
    await image(buildSatisfactionPie(sat.positive, sat.negative, { theme: "light", reducedMotion: true }), 900, 320);
    if (report.satisfaction.timeline.length > 1) await image(buildSatisfactionTimeline(report.satisfaction.timeline, { theme: "light", reducedMotion: true }), 900, 260);
  }

  /* ---------------------------------------------------------------- pontuação */
  if (report.scoreHistogram.length && report.ranking.length) {
    heading("Distribuição de pontuações");
    await image(
      buildSimpleBarOption({ categories: report.scoreHistogram.map((h) => h.range), series: [{ name: "Participantes", data: report.scoreHistogram.map((h) => h.count) }], theme: "light", reducedMotion: true }),
      900,
      300,
    );
  }

  if (report.hardest.length) {
    heading("Questões com maior dificuldade");
    table(
      ["Nº", "Pergunta", "Respondentes", "Acerto"],
      report.hardest.map((q) => [q.position, q.title, q.respondents, pct(q.accuracyPct)]),
      [6, 60, 14, 12],
      ["left", "left", "right", "right"],
    );
  }

  if (report.top10.length) {
    heading("Top 10");
    table(
      ["Posição", "Participante", "Pontos", "Acertos", "Respondidas"],
      report.top10.map((r) => [`${r.position}º`, r.displayName, r.score, r.correctCount, r.answeredCount]),
      [10, 46, 14, 14, 16],
      ["left", "left", "right", "right", "right"],
    );
  }

  /* ---------------------------------------------------------------- perguntas */
  if (report.questions.length) {
    heading("Resultados por pergunta");
    for (const q of report.questions) {
      ensure(80);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      pdf.setTextColor(...NAVY);
      const title = pdf.splitTextToSize(pdfText(`${q.position}. ${q.title}`), cw) as string[];
      pdf.text(title, m, y + 10);
      y += title.length * 13 + 2;
      const parts = [
        QUESTION_TYPE_LABELS[q.type] ?? q.type,
        `${q.respondents} respondentes`,
        `taxa de resposta ${pct(q.responseRatePct)}`,
        `tempo médio ${sec(q.avgResponseMs)}`,
      ];
      if (q.accuracyPct !== null) parts.push(`acerto ${pct(q.accuracyPct)}`);
      if (q.nps?.score !== null && q.nps?.score !== undefined) parts.push(`NPS ${q.nps.score}`);
      else if (q.mean !== null) parts.push(`média ${q.mean.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}`);
      paragraph(parts.join(" · "), 8);
      if (q.respondents === 0) {
        paragraph("Sem respostas registradas.", 8);
        continue;
      }
      const numeric = q.type === "ESCALA" || q.type === "NPS";
      const dto = toResultsDTO(q, t.registered);
      const option = buildChartOption(numeric ? "column" : "bar_horizontal", dto, {
        theme: "light",
        config: { showPercent: true, showValues: true, showLegend: false, sortDesc: false, colors: null },
        reducedMotion: true,
      });
      const pxH = numeric ? 300 : Math.min(520, Math.max(160, 44 * q.categories.length + 40));
      await image(option, 900, pxH);
    }
  }

  /* ---------------------------------------------------------------- perfil */
  const demo = report.demographics.filter((d) => d.values.length);
  if (demo.length) {
    heading("Dados de perfil");
    for (const d of demo) {
      paragraph(d.label, 9, NAVY);
      const vals = d.values.slice(0, 15);
      await image(
        buildSimpleBarOption({ categories: vals.map((v) => v.value), series: [{ name: "Participantes", data: vals.map((v) => v.count) }], theme: "light", horizontal: true, reducedMotion: true }),
        900,
        Math.max(140, 34 * vals.length + 30),
      );
    }
  }

  paragraph("Este relatório não contém dados de contato. Contatos só são exportados (CSV/XLSX) para participantes com consentimento de marketing vigente.", 8);

  /* ---------------------------------------------------------------- rodapé */
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(...MUTED);
    pdf.text(pdfText(`Gestalt Live · ${report.event.title} · ${report.session.name}`), m, ph - 18, { maxWidth: cw - 80 });
    pdf.text(`Página ${i} de ${pages}`, pw - m, ph - 18, { align: "right" });
  }
  pdf.save(`${opts.filename}.pdf`);
}
