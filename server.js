import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Sequelize, DataTypes } from 'sequelize';
import fs from 'fs';
import path from 'path';

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: './database.sqlite',
    logging: false
});

const Invoice = sequelize.define('Invoice', {
    supplierName: DataTypes.STRING,
    vatNumber: DataTypes.STRING,
    timestamp: DataTypes.STRING,
    totalAmount: DataTypes.STRING,
    vatAmount: DataTypes.STRING,
    qrCodeBase64: DataTypes.TEXT
});

await sequelize.sync();

function createTLVSegment(tag, value) {
    const tagBuf = Buffer.from([tag]);
    const valBuf = Buffer.from(value, 'utf8');
    const lenBuf = Buffer.from([valBuf.length]);
    return Buffer.concat([tagBuf, lenBuf, valBuf]);
}

function generateZatcaString(supplierName, vatNumber, timestamp, totalAmount, vatAmount) {
    const tlv1 = createTLVSegment(1, supplierName);
    const tlv2 = createTLVSegment(2, vatNumber);
    const tlv3 = createTLVSegment(3, timestamp);
    const tlv4 = createTLVSegment(4, totalAmount);
    const tlv5 = createTLVSegment(5, vatAmount);
    return Buffer.concat([tlv1, tlv2, tlv3, tlv4, tlv5]).toString('base64');
}

const server = new Server(
    { name: "zatca-invoice-mcp-server", version: "1.0.0" },
    { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "save_zatca_invoice",
                description: "أداة ذكية لحساب الضرائب وتوليد الـ QR المشفر بهيكل TLV المعتمد وأرشفة الفاتورة رقمياً في SQLite",
                inputSchema: {
                    type: "object",
                    properties: {
                        supplierName: { type: "string" },
                        vatNumber: { type: "string" },
                        amountBeforeVat: { type: "string" }
                    },
                    required: ["supplierName", "vatNumber", "amountBeforeVat"]
                }
            },
            {
                name: "load_zatca_compliance_skill",
                description: "تحميل الذاكرة الإجرائية وقواعد التعامل مع الامتثال الضريبي السعودي من ملف SKILL.md ديناميكياً عند الحاجة",
                inputSchema: { type: "object", properties: {} }
            }
        ]
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    
    if (name === "save_zatca_invoice") {
        try {
            const { supplierName, vatNumber, amountBeforeVat } = request.params.arguments;
            const baseAmount = parseFloat(amountBeforeVat) || 0;
            const vat = baseAmount * 0.15;
            const total = baseAmount + vat;
            const timestamp = new Date().toISOString();
            
            const qrCodeBase64 = generateZatcaString(supplierName, vatNumber, timestamp, total.toFixed(2), vat.toFixed(2));
            
            await Invoice.create({ supplierName, vatNumber, timestamp, totalAmount: total.toFixed(2), vatAmount: vat.toFixed(2), qrCodeBase64 });
            
            return {
                content: [{ type: "text", text: JSON.stringify({ success: true, qrCodeBase64, totalAmount: total.toFixed(2), vatAmount: vat.toFixed(2) }) }]
            };
        } catch (error) {
            return { isError: true, content: [{ type: "text", text: error.message }] };
        }
    }
    
    if (name === "load_zatca_compliance_skill") {
        try {
            // استخدام مسار ديناميكي للوصول لملف السكيلز بمرونة في بيئة لينكس
            const skillPath = path.resolve('.agents', 'skills', 'zatca_compliance', 'SKILL.md');
            if (!fs.existsSync(skillPath)) {
                return { isError: true, content: [{ type: "text", text: `Skill file not found at: ${skillPath}` }] };
            }
            const skillContent = fs.readFileSync(skillPath, 'utf8');
            return { content: [{ type: "text", text: skillContent }] };
        } catch (error) {
            return { isError: true, content: [{ type: "text", text: `Failed to read SKILL.md file: ${error.message}` }] };
        }
    }
    
    throw new Error(`Unknown tool: ${name}`);
});

async function run() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("🚀 ZATCA MCP Server with Agent Skills activated successfully over STDIO");
}

run().catch((error) => {
    console.error("❌ Fatal error running MCP server:", error);
    process.exit(1);
});
