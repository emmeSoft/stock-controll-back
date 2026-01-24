


    export function translate(entityIdField) {
    
        if(entityIdField === "clientsId") { 
          entityIdField = "clientId"  
        }else if (entityIdField === "usersId"){
          entityIdField = "userId"
        } else if (entityIdField === "suppliersId"){
          entityIdField = "supplierId"
        } else if (entityIdField === "categoriesId"){
          entityIdField = "categoryId"
        } else if (entityIdField === "productsId"){
          entityIdField = "productId"
        } 


      
    return entityIdField;


}

export function reverseTranslate(entity) {

    if(entity === "clients") {    
      entity = "client"  
    }else if (entity === "users"){
      entity = "user"
    } else if (entity === "supplier"){       
      entity = "supplier"
    } else if (entity === "category"){       
      entity = "categories"
    } else if (entity === "products"){       
      entity = "product"
    }     

return entity;

} 
