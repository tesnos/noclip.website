
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { readFileSync, writeFileSync } from "fs";
import { hexzero } from "../../util";
import * as BYML from "../../byml";
import * as MIO0 from "../../Common/Compression/MIO0";

function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return new ArrayBufferSlice(b.buffer as ArrayBuffer);
}

const pathBaseIn  = `../../../data/MarioKart64_Raw`;
const pathBaseOut = `../../../data/MarioKart64`;

function extractCourse(romData: ArrayBufferSlice, id: number) {
    const view = romData.createDataView(0x122390 + (id * 0x30));

    const seg6_start    = view.getUint32(0x00, false);
    const seg6_end      = view.getUint32(0x04, false);
    const vtx_start     = view.getUint32(0x08, false);
    const vtx_end       = view.getUint32(0x0C, false);
    const texref_start  = view.getUint32(0x10, false);
    const texref_end    = view.getUint32(0x14, false);
    const vtxseg        = view.getUint32(0x18, false);
    const unk_0         = view.getUint32(0x1C, false);
    const packdl_off    = view.getUint32(0x20, false);
    const finalcmd      = view.getUint32(0x24, false);
    const tblseg        = view.getUint32(0x28, false);
    const unk_1         = view.getUint16(0x2C, false);
    const padding       = view.getUint16(0x2E, false);

    const crg1 = {
        Name: id,
        Seg6: MIO0.decompress(romData.slice(seg6_start, seg6_end)),
        Vtx: MIO0.decompress(romData.slice(vtx_start, vtx_end)),
        TexRef: romData.slice(texref_start, texref_end),
        PackDL_Off: packdl_off,
        FinalCMD: finalcmd,
    };

    const data = BYML.write(crg1, BYML.FileType.CRG1);
    writeFileSync(`${pathBaseOut}/${hexzero(id, 2).toUpperCase()}_arc.crg1`, Buffer.from(data));
}

function main() {
    const romData = fetchDataSync(`${pathBaseIn}/rom.z64`);

    for (let i = 0; i < 0x14; i++) {
        extractCourse(romData, i);
    }

    const crg1 = {
        TexData: romData.slice(0x641F70, 0x712DC0),
    };

    const data = BYML.write(crg1, BYML.FileType.CRG1);
    writeFileSync(`${pathBaseOut}/common_arc.crg1`, Buffer.from(data));
}

main();
