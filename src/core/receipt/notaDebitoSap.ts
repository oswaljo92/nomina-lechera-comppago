import type { RegistroGuardado } from '../db/repo.ts';
import type { InformativoNdImportada, NotaDebitoCalculada, NotaDebitoImportada, TipoNomina } from '../types.ts';
import type { DatosComprobante } from './comprobante.ts';

/**
 * Notas de débito importadas que comparten el mismo SAP y la misma fábrica
 * (2+ filas ya emparejadas a un registro) se tratan como el mismo proveedor
 * real, aunque tengan códigos o nombres distintos en el Excel (típico:
 * errores de tipeo, o el mismo proveedor con actividad de leche y de
 * transporte). Se limita a la misma fábrica a propósito: el mismo SAP en
 * fábricas distintas no se combina (son plantas distintas), según pidió el
 * usuario.
 */
export interface GrupoNdSap {
  sap: string;
  fabrica: string;
  miembros: Array<{
    registroId: string;
    tipo: TipoNomina;
    centimos: number;
    fechaNota: string;
    informativo: Omit<InformativoNdImportada, 'codigo'>;
  }>;
  centimosTotal: number;
}

/** Código de registro_id -> el grupo SAP al que pertenece, solo para los
 * registros con 2+ filas emparejadas bajo el mismo SAP+fábrica. */
export function gruposNdPorSap(filas: NotaDebitoImportada[]): Map<string, GrupoNdSap> {
  const porClave = new Map<string, NotaDebitoImportada[]>();
  for (const f of filas) {
    if (!f.registroId || !f.sapExcel || !f.fabricaExcel) continue;
    const clave = `${f.sapExcel.trim().toUpperCase()}::${f.fabricaExcel.trim().toUpperCase()}`;
    const lista = porClave.get(clave) ?? [];
    lista.push(f);
    porClave.set(clave, lista);
  }

  const porRegistro = new Map<string, GrupoNdSap>();
  for (const lista of porClave.values()) {
    if (lista.length < 2) continue;
    const grupo: GrupoNdSap = {
      sap: lista[0]!.sapExcel!,
      fabrica: lista[0]!.fabricaExcel!,
      miembros: lista.map((f) => ({
        registroId: f.registroId!,
        tipo: f.tipo,
        centimos: f.centimos,
        fechaNota: f.fechaNota,
        informativo: {
          tipo: f.tipo,
          litros: f.tipo === 'leche' ? f.litrosEnviados : f.litrosTransportados,
          precioUsd: f.tipo === 'leche' ? f.precioUsdLts : f.precioUsdFlete,
          bsXLtsInicio: f.bsXLtsInicio,
          bsXLtsAjustado: f.bsXLtsAjustado,
          difXLts: f.difXLts,
        },
      })),
      centimosTotal: lista.reduce((a, f) => a + f.centimos, 0),
    };
    for (const f of lista) porRegistro.set(f.registroId!, grupo);
  }
  return porRegistro;
}

/**
 * Reemplaza la nota de débito de `datos` (individual, combinada o agrupada,
 * lo que sea que traiga) por la del grupo SAP: una sola nota, con una línea
 * por miembro (Leche/Flete si mezcla tipos, CÓDIGO N si son del mismo tipo,
 * como ya hace la agrupación del mismo tipo) y el total sumado tal cual lo
 * trae el Excel de cada fila — sin recalcular nada. No toca litros, bruto,
 * deducciones ni el resto de `datos`: la factura de cada código sigue
 * generándose por separado, solo la ND se combina.
 */
export function datosConNdPorSap(
  datos: DatosComprobante,
  grupo: GrupoNdSap,
  registrosPorId: Map<string, RegistroGuardado>,
): DatosComprobante {
  const mismoTipo = new Set(grupo.miembros.map((m) => m.tipo)).size === 1;

  const porCodigo = grupo.miembros.map((m) => {
    const registro = registrosPorId.get(m.registroId);
    const etiqueta = mismoTipo
      ? `CÓDIGO ${registro?.leido.codigo ?? m.registroId}`
      : m.tipo === 'leche'
        ? 'Leche'
        : 'Flete';
    const resultado: NotaDebitoCalculada = {
      aplica: true,
      origen: 'importado',
      precioUsd: 0,
      litrosBase: registro?.leido.litrosTotal ?? 0,
      fechaFactura: datos.fechaFactura,
      fechaNota: m.fechaNota,
      fechaCalculo: 'nota',
      fechaTasaFin: '',
      fechaTasaIni: '',
      tasaIni: 0,
      tasaFin: 0,
      diferenciaTasa: 0,
      montoUsd: 0,
      centimos: m.centimos,
      informativo: { codigo: registro?.leido.codigo ?? '', ...m.informativo },
    };
    return { codigo: etiqueta, resultado };
  });

  return {
    ...datos,
    notaDebito: null,
    notaDebitoCombinada: undefined,
    notaDebitoAgrupada: { aplica: true, centimos: grupo.centimosTotal, porCodigo },
  };
}
