/**
 * Permissions Cache - Cache en memoria para permisos de usuario
 * Evita consultas repetitivas a la base de datos
 */
class PermissionsCache {
  constructor() {
    this.cache = new Map();
    this.defaultTTL = 5 * 60 * 1000; // 5 minutos
  }

  /**
   * Obtiene un valor del cache
   * @param {string} key - Clave del cache
   * @returns {any|null} Valor cacheado o null si expiró/no existe
   */
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  /**
   * Guarda un valor en cache
   * @param {string} key - Clave del cache
   * @param {any} value - Valor a guardar
   * @param {number} ttlMs - Tiempo de vida en milisegundos (opcional)
   */
  set(key, value, ttlMs = this.defaultTTL) {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
  }

  /**
   * Invalida una clave específica
   * @param {string} key - Clave a invalidar
   */
  invalidate(key) {
    this.cache.delete(key);
  }

  /**
   * Invalida todas las claves que contengan un patrón
   * @param {string} pattern - Patrón a buscar en las claves
   */
  invalidatePattern(pattern) {
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Invalida todos los permisos de un usuario
   * @param {string} userId - ID del usuario
   */
  invalidateUser(userId) {
    this.invalidatePattern(`user_${userId}`);
  }

  /**
   * Limpia todo el cache
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Obtiene estadísticas del cache (para debugging)
   */
  getStats() {
    let active = 0;
    let expired = 0;
    const now = Date.now();

    for (const entry of this.cache.values()) {
      if (entry.expiresAt > now) {
        active++;
      } else {
        expired++;
      }
    }

    return {
      total: this.cache.size,
      active,
      expired
    };
  }
}

module.exports = new PermissionsCache();
