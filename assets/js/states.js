// States/regions/provinces for a set of countries I can list confidently
// and correctly. For any country NOT in this object, the Region field
// simply stays a free-text input — nothing forces a match, so it degrades
// gracefully instead of guessing at a list I'm not sure is accurate.
// Add more countries here as you need them.
const STATES_BY_COUNTRY = {
  "Ghana": [
    "Greater Accra","Ashanti","Central","Eastern","Western","Western North","Volta","Oti",
    "Northern","North East","Savannah","Bono","Bono East","Ahafo","Upper East","Upper West"
  ],
  "Nigeria": [
    "Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno","Cross River",
    "Delta","Ebonyi","Edo","Ekiti","Enugu","FCT (Abuja)","Gombe","Imo","Jigawa","Kaduna","Kano",
    "Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa","Niger","Ogun","Ondo","Osun","Oyo",
    "Plateau","Rivers","Sokoto","Taraba","Yobe","Zamfara"
  ],
  "Togo": ["Maritime","Plateaux","Centrale","Kara","Savanes"],
  "Kenya": [
    "Baringo","Bomet","Bungoma","Busia","Elgeyo-Marakwet","Embu","Garissa","Homa Bay","Isiolo",
    "Kajiado","Kakamega","Kericho","Kiambu","Kilifi","Kirinyaga","Kisii","Kisumu","Kitui","Kwale",
    "Laikipia","Lamu","Machakos","Makueni","Mandera","Marsabit","Meru","Migori","Mombasa","Murang'a",
    "Nairobi","Nakuru","Nandi","Narok","Nyamira","Nyandarua","Nyeri","Samburu","Siaya","Taita-Taveta",
    "Tana River","Tharaka-Nithi","Trans Nzoia","Turkana","Uasin Gishu","Vihiga","Wajir","West Pokot"
  ],
  "South Africa": [
    "Eastern Cape","Free State","Gauteng","KwaZulu-Natal","Limpopo","Mpumalanga","Northern Cape",
    "North West","Western Cape"
  ],
  "United States": [
    "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware",
    "Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana",
    "Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana",
    "Nebraska","Nevada","New Hampshire","New Jersey","New Mexico","New York","North Carolina",
    "North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina",
    "South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia",
    "Wisconsin","Wyoming"
  ],
  "Canada": [
    "Alberta","British Columbia","Manitoba","New Brunswick","Newfoundland and Labrador",
    "Northwest Territories","Nova Scotia","Nunavut","Ontario","Prince Edward Island","Quebec",
    "Saskatchewan","Yukon"
  ]
};
