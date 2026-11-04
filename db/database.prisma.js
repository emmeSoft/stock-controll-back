const { PrismaClient } = require("@prisma/client")

// `transactionOptions` sube el presupuesto de la transacción interactiva
// (default de Prisma: timeout 5000ms, maxWait 2000ms) — insuficiente contra
// la latencia real medida hacia el Supabase remoto de este entorno (~400-800ms
// por round-trip; `salesServices.create` hace 10+ round-trips dentro de su
// $transaction). Sin este margen, Prisma cierra la tx server-side a mitad de
// camino y cualquier query posterior revienta con "Transaction not found" —
// no es una condición de carrera, es un timeout de red puro. Config-only,
// no cambia ninguna lógica de negocio.
const prisma = new PrismaClient({
	transactionOptions: {
		maxWait: 10000,
		timeout: 20000,
	},
})

module.exports = {
	...prisma
}

