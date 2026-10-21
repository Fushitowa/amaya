import { useState } from "react";

import Header from "../components/Header.jsx";
import MenuProductImage from "../components/MenuProductImage.jsx";
import { useMenu } from "../context/MenuContext.jsx";

import "../assets/css/Menu.css";

function Menu() {
  const { products } = useMenu();
  const [searchTerm, setSearchTerm] = useState("");

  const categoryTitles = {
    "foods / snacks": "Foods / Snacks",
    "fries & sip": "Fries & Sip",
    "burgers and hotdogs": "Burgers and Hotdogs",
    desserts: "Desserts",
    dessert: "Desserts",
    milktea: "Milktea",
    "milk tea": "Milk Tea",
    "float series": "Float Series",
    "fruity soda": "Fruity Soda",
    "fruity milk": "Fruity Milk",
    "iced coffee": "Iced Coffee",
    drinks: "Drinks",
    snacks: "Snacks",
  };

  const descriptionByCategory = {
    "foods / snacks": "Amaya's crispy street food, dumplings, and savory comfort snacks.",
    "fries & sip": "Amaya's crispy seasoned fries paired with your favorite drink.",
    "burgers and hotdogs": "Amaya's flame-grilled burgers, savory hotdogs, and loaded buns.",
    desserts: "Amaya's sweet dessert moments, sundaes, and treats made to delight.",
    dessert: "Amaya's sweet dessert moments, sundaes, and treats made to delight.",
    milktea: "Amaya's rich and creamy milk teas brewed fresh with smooth toppings.",
    "milk tea": "Amaya's rich and creamy milk teas brewed fresh with smooth toppings.",
    "float series": "Amaya's chilled flavored sodas crowned with velvety soft ice cream.",
    "fruity soda": "Amaya's effervescent, sparkling fruit-infused coolers.",
    "fruity milk": "Amaya's silky fresh milk blends swirled with luscious fruit purees.",
    "iced coffee": "Amaya's bold espresso pours brewed cold over fresh milk and ice.",
    drinks: "Amaya's crafted drinks for every kind of refreshment.",
    snacks: "Amaya's savory bites made for sharing and savoring.",
  };

  const availableProducts = products.filter((product) => product.available && Number(product.stock) > 0);
  const dynamicCategories = Array.from(
    new Set(availableProducts.map((p) => String(p.category || "Uncategorized").trim()).filter(Boolean))
  );
  const activeCategories = dynamicCategories.length > 0 ? dynamicCategories : Object.values(categoryTitles);

  const menuSections = activeCategories.map((category) => {
    const matchedKey = Object.keys(categoryTitles).find(
      (key) => categoryTitles[key].toLowerCase() === category.toLowerCase() || key.toLowerCase() === category.toLowerCase()
    );
    const fallbackDesc = `Amaya's freshly crafted ${category.toLowerCase()} favorites.`;
    const defaultDesc = matchedKey ? descriptionByCategory[matchedKey] : fallbackDesc;

    return {
      id: matchedKey || category.toLowerCase().replace(/\s+/g, "-"),
      label: category,
      sectionTitle: category,
      defaultDescription: defaultDesc,
      items: availableProducts.filter((product) => product.category === category),
    };
  });

  const filteredSections = menuSections.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      const text = `${item.name} ${item.description} ${section.label}`;
      return text.toLowerCase().includes(searchTerm.toLowerCase());
    }),
  }));

  return (
    <>
      <Header />

      <main className="menu-page">
        <section className="menu-hero">
          <div className="menu-hero-content">
            <span className="menu-eyebrow">Amaya Kitchen</span>
            <h1>Our Menu</h1>
            <p>
              Fresh meals, crafted drinks, and comforting desserts made to
              turn every visit into a memorable moment.
            </p>
          </div>
        </section>

        <section className="menu-section">
          <div className="menu-section-inner">
            <div className="menu-section-heading">
              <div>
                <span className="section-label">Food & Drinks</span>
                <h2>Amaya's Favorites</h2>
              </div>

              <div className="menu-search-wrap">
                <label className="menu-search-label" htmlFor="menu-search">
                  Search Menu
                </label>
                <input
                  id="menu-search"
                  className="menu-search-input"
                  type="search"
                  placeholder="Search drinks, snacks, desserts..."
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
              </div>
            </div>

            <div className="menu-category-list">
              {filteredSections.map((section) => (
                <section className="menu-category-block" key={section.id}>
                  <div className="menu-category-title-row">
                    <span className="menu-category-heading">{section.sectionTitle}</span>
                    <span className="menu-category-count">{section.items.length}</span>
                  </div>

                  {section.items.length > 0 ? (
                    <div className="menu-grid">
                      {section.items.map((item) => (
                        <article className="menu-card" key={item.id}>
                          <div className="menu-card-image-wrap">
                            <MenuProductImage
                              src={item.image}
                              alt={item.title}
                              className="menu-card-image"
                              style={{ objectFit: "cover" }}
                            />
                          </div>

                          <div className="menu-card-content">
                            <span className="menu-category-name">{section.label}</span>
                            <h3>{item.name}</h3>
                            <p>{item.description || section.defaultDescription || descriptionByCategory[section.id]}</p>
                            <strong>₱{String(item.price).replace("₱", "")}</strong>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="menu-empty">No menu items found.</p>
                  )}
                </section>
              ))}
            </div>
          </div>
        </section>

        <section className="menu-feature-strip">
          <div className="menu-feature-grid">
            <article className="feature-tile">
              <span>House Blend</span>
              <h3>Freshly Made</h3>
              <p>Every drink is prepared with daily care and handcrafted balance.</p>
            </article>

            <article className="feature-tile">
              <span>Comfort Kitchen</span>
              <h3>Simple & Cozy</h3>
              <p>Comfort food classics made warm, generous, and satisfying.</p>
            </article>

            <article className="feature-tile">
              <span>Amaya Treats</span>
              <h3>Sweet Moments</h3>
              <p>Signature desserts and café specialties for a perfect finish.</p>
            </article>
          </div>
        </section>
      </main>
    </>
  );
}

export default Menu;
