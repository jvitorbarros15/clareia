/* Local demonstration fixtures. No real politician or official expense is represented. */
window.ClareiaData = (() => {
  const people = [
    { id: 'ana', name: 'Ana Martins', uf: 'SP', total: 240000, months: 12, projects: 14, votes: 88, categories: [.5, .3, .2] },
    { id: 'bruno', name: 'Bruno Costa', uf: 'MG', total: 180000, months: 12, projects: 21, votes: 76, categories: [.3, .5, .2] },
    { id: 'carla', name: 'Carla Nunes', uf: 'RJ', total: 120000, months: 12, projects: 32, votes: 92, categories: [.25, .35, .4] },
    { id: 'diego', name: 'Diego Rocha', uf: 'MG', total: 90000, months: 3, projects: 9, votes: 20, categories: [.4, .4, .2] },
    { id: 'fernanda', name: 'Fernanda Lima', uf: 'SP', total: 60000, months: 6, projects: 18, votes: 44, categories: [.2, .3, .5] }
  ];
  const categories = ['Divulgação', 'Passagens', 'Outras'];
  const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  // Integer apportionment ensures that every displayed aggregate equals its records.
  function split(total, weights) {
    const sum = weights.reduce((a, b) => a + b, 0);
    const values = weights.map(w => Math.floor(total * w / sum));
    values[values.length - 1] += total - values.reduce((a, b) => a + b, 0);
    return values;
  }
  function dataset(model, year) {
    return people.map((person, index) => {
      let total = person.total;
      if (person.id === 'carla' && model === 'investigacao') total = 150000;
      if (year === '2024') total = Math.round(total * [.65, .9, 1.1, .8, 1.2][index]);
      const byCategory = split(total, person.categories);
      const records = [];
      byCategory.forEach((value, category) => {
        const weights = Array.from({ length: person.months }, (_, i) => [8, 10, 9, 14, 12, 10, 13, 15, 18, 21, 17, 13][(i + index) % 12]);
        split(value, weights).forEach((amount, month) => records.push({
          id: `DEMO-${year}-${person.id}-${category + 1}-${month + 1}`,
          date: `${year}-${String(month + 1).padStart(2, '0')}-15`,
          month, category: categories[category], amount,
          supplier: ['Gráfica Exemplo', 'Viagens Demonstração', 'Serviços Modelo'][category]
        }));
      });
      return { ...person, total, year, records, byCategory,
        projects: person.projects + (year === '2024' ? -3 : 0),
        votes: person.votes + (year === '2024' ? -6 : 0) };
    });
  }
  return { dataset, categories, monthNames };
})();
