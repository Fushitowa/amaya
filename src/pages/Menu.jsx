import { useState } from "react";

import Header from "../components/Header.jsx";
import { useMenu } from "../context/MenuContext.jsx";

import "../assets/css/Menu.css";

function Menu() {
  const { products } = useMenu();
  const [searchTerm, setSearchTerm] = useState("");

  const categoryTitles = {
    drinks: "Drinks",
    snacks: "Snacks",
    milktea: "Milktea",
    dessert: "Desserts",
  };

  const descriptionByCategory = {
    drinks: "Amaya's crafted drinks for every kind of refreshment.",
    snacks: "Amaya's savory bites made for sharing and savoring.",
    milktea: "Amaya's creamy milktea favorites with a smooth finish.",
    dessert: "Amaya's sweet dessert moments made to delight.",
  };

  const menuSections = Object.entries(categoryTitles).map(([id, label]) => ({
    id,
    label,
    sectionTitle: label,
    items: products.filter((product) => product.available && product.category === label),
  }));

  const filteredSections = menuSections.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      const text = `${item.title} ${item.description} ${section.label}`;
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
                            <div
                              className="menu-card-image"
                              style={{ backgroundImage: `url(${item.image})` }}
                              role="img"
                              aria-label={item.title}
                            ></div>
                          </div>

                          <div className="menu-card-content">
                            <span className="menu-category-name">{section.label}</span>
                            <h3>{item.name}</h3>
                            <p>{item.description || descriptionByCategory[section.id]}</p>
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
