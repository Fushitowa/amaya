import { Link } from "react-router-dom";
import Header from "../components/Header.jsx";
import { formatBusinessTime, useBusiness } from "../context/BusinessContext.jsx";

import locationIcon from "../assets/images/icon/location.png";
import callIcon from "../assets/images/icon/call.png";
import emailIcon from "../assets/images/icon/email.png";

import "../assets/css/Contact.css";

function Contact() {
  const { businessSettings } = useBusiness();
  const { businessName, email, phone, address, openingTime, closingTime } = businessSettings;
  const formattedHours = `${formatBusinessTime(openingTime)} - ${formatBusinessTime(closingTime)}`;

  const handleSubmit = (event) => {
    event.preventDefault();

    alert("Thank you for contacting Amaya! We will get back to you soon.");
    event.target.reset();
  };

  return (
    <>
      <Header />

      <main className="contact-page">

        
        <section className="contact-hero">
          <div className="contact-hero-content">

            <span className="contact-eyebrow">
              Get In Touch
            </span>

            <h1>
              We&rsquo;d Love to
              <br />
              Hear From You.
            </h1>

            <p>
              Have a question, suggestion, or simply want to say hello?
              Our team at Amaya is always happy to hear from you.
            </p>

          </div>
        </section>


        
        <section className="contact-section">

          <div className="contact-container">

            
            <div className="contact-info">

              <span className="section-label">
                Contact Information
              </span>

              <h2>
                Let&rsquo;s Start a Conversation
              </h2>

              <p className="contact-description">
                Whether you have a question about our menu, an order,
                or anything else, feel free to reach out. We&rsquo;re here
                to help.
              </p>


              
              <ul className="contact-details">

                
                <li className="contact-detail">

                  <span className="contact-icon">
                    <img src={locationIcon} alt="" />
                  </span>

                  <address>
                    <span>Visit Us</span>
                    <strong>{businessName}</strong>
                    <p>{address}</p>
                  </address>

                </li>


                
                <li className="contact-detail">

                  <span className="contact-icon">
                    <img src={callIcon} alt="" />
                  </span>

                  <div>
                    <span>Call Us</span>

                    <strong>
                      <a href={`tel:${phone}`}>{phone}</a>
                    </strong>

                    <p>Available during opening hours</p>
                  </div>

                </li>


                
                <li className="contact-detail">

                  <span className="contact-icon">
                    <img src={emailIcon} alt="" />
                  </span>

                  <div>
                    <span>Email Us</span>

                    <strong>
                      <a href={`mailto:${email}`}>{email}</a>
                    </strong>

                    <p>We usually reply within 24 hours</p>
                  </div>

                </li>

              </ul>


              
              <div className="opening-hours">

                <div className="hours-heading">
                  <span className="hours-icon" aria-hidden="true">
                    ◷
                  </span>

                  <h3>Opening Hours</h3>
                </div>

                <dl>
                  <div className="hours-row">
                    <dt>Monday – Friday</dt>
                    <dd>{formattedHours}</dd>
                  </div>

                  <div className="hours-row">
                    <dt>Saturday – Sunday</dt>
                    <dd>{formattedHours}</dd>
                  </div>
                </dl>

              </div>

            </div>


            
            <div className="contact-form-card">

              <div className="form-heading">

                <span className="section-label">
                  Send A Message
                </span>

                <h2>How Can We Help?</h2>

                <p>Fill out the form below and we&rsquo;ll get back to you.</p>

              </div>


              <form
                className="contact-form"
                onSubmit={handleSubmit}
                noValidate
              >

                
                <div className="form-row">

                  <div className="contact-form-group">
                    <label htmlFor="name">Your Name</label>

                    <input
                      type="text"
                      id="name"
                      name="name"
                      autoComplete="name"
                      placeholder="Enter your name"
                      required
                    />
                  </div>

                  <div className="contact-form-group">
                    <label htmlFor="email">Email Address</label>

                    <input
                      type="email"
                      id="email"
                      name="email"
                      autoComplete="email"
                      placeholder="Enter your email"
                      required
                    />
                  </div>

                </div>


                
                <div className="contact-form-group">
                  <label htmlFor="subject">Subject</label>

                  <input
                    type="text"
                    id="subject"
                    name="subject"
                    placeholder="What is this about?"
                    required
                  />
                </div>


                
                <div className="contact-form-group">
                  <label htmlFor="message">Message</label>

                  <textarea
                    id="message"
                    name="message"
                    rows="6"
                    placeholder="Write your message here..."
                    required
                  ></textarea>
                </div>


                
                <button type="submit" className="contact-submit-button">
                  Send Message
                  <span aria-hidden="true">→</span>
                </button>

              </form>

            </div>

          </div>

        </section>


        
        <section className="contact-cta">

          <div className="contact-cta-content">

            <span>Ready To Visit?</span>

            <h2>
              Good Food.
              <br />
              Great Moments.
            </h2>

            <p>Come by Amaya and make your next moment a memorable one.</p>

            <Link to="/menu" className="contact-cta-button">
              Explore Our Menu
            </Link>

          </div>

        </section>

      </main>
    </>
  );
}

export default Contact;