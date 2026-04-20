function translate(entityIdField) {
  if (entityIdField === "clientsId") {
    entityIdField = "clientId";
  } else if (entityIdField === "usersId") {
    entityIdField = "userId";
  } else if (entityIdField === "suppliersId") {
    entityIdField = "supplierId";
  } else if (entityIdField === "categoriesId") {
    entityIdField = "categoryId";
  } else if (entityIdField === "productsId") {
    entityIdField = "productId";
  }

  return entityIdField;
}

function reverseTranslate(entity) {
  if (entity === "clients") {
    entity = "client";
  } else if (entity === "users") {
    entity = "user";
  } else if (entity === "suppliers" || entity === "supplier") {
    entity = "supplier";
  } else if (entity === "categories" || entity === "category") {
    entity = "categories";
  } else if (entity === "products" || entity === "product") {
    entity = "product";
  } else if (entity === "stores" || entity === "store") {
    entity = "store";
  }

  return entity;
}

module.exports = { translate, reverseTranslate };
